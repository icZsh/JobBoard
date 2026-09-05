import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { hasLikelyBinaryContent } from "./input";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const MAX_RESUME_TEXT_CHARS = 200_000;
export const MAX_DOCX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export class ResumeUploadError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ResumeUploadError";
  }
}

export function normalizeResumeName(name: string) {
  return (
    path
      .basename(name.replace(/\\/g, "/"))
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 180) || "resume.txt"
  );
}

export function validateConfirmedText(value: unknown) {
  if (typeof value !== "string" || !value.trim())
    throw new ResumeUploadError("Review text cannot be empty.");
  if (value.length > MAX_RESUME_TEXT_CHARS)
    throw new ResumeUploadError(
      "Resume text is too long. Keep it below 200,000 characters.",
      413,
    );
  if (hasLikelyBinaryContent(value))
    throw new ResumeUploadError(
      "Resume text contains unreadable binary content.",
    );
  return value.trim();
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

// Bound actual inflation, not attacker-controlled ZIP size declarations, before parsing XML.
export function validateDocxArchive(bytes: Buffer) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw new ResumeUploadError(
      "This DOCX is corrupt or encrypted. Save an unencrypted copy and upload it again.",
    );
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65_557);
    offset--
  ) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (
    end < 0 ||
    end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    throw new ResumeUploadError("This DOCX archive is unsupported or corrupt.");
  const count = bytes.readUInt16LE(end + 10);
  const directoryStart = bytes.readUInt32LE(end + 16);
  const directorySize = bytes.readUInt32LE(end + 12);
  if (
    count !== bytes.readUInt16LE(end + 8) ||
    directoryStart + directorySize !== end
  )
    throw new ResumeUploadError("This DOCX directory is corrupt.");
  let cursor = directoryStart;
  let expanded = 0;
  let hasDocument = false;
  const names = new Set<string>();
  const ranges: Array<[number, number]> = [];
  if (count > 1500)
    throw new ResumeUploadError("This DOCX contains too many embedded files.");
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new ResumeUploadError("This DOCX archive is corrupt.");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const declaredSize = bytes.readUInt32LE(cursor + 24);
    const local = bytes.readUInt32LE(cursor + 42);
    if (flags & 0x41)
      throw new ResumeUploadError("Encrypted DOCX files are not supported.");
    if (![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34) !== 0)
      throw new ResumeUploadError(
        "This DOCX compression format is unsupported.",
      );
    if (expanded + declaredSize > MAX_DOCX_EXPANDED_BYTES)
      throw new ResumeUploadError(
        "This DOCX expands beyond the supported size.",
        413,
      );
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const entryLength =
      46 +
      nameLength +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
    if (cursor + entryLength > end)
      throw new ResumeUploadError("This DOCX archive is corrupt.");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString("utf8");
    if (
      names.has(name) ||
      name.startsWith("/") ||
      name.split(/[\\/]/).includes("..")
    )
      throw new ResumeUploadError(
        "This DOCX contains invalid or duplicate entries.",
      );
    names.add(name);
    if (
      local + 30 > directoryStart ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method
    )
      throw new ResumeUploadError("This DOCX local header is corrupt.");
    const localNameLength = bytes.readUInt16LE(local + 26);
    const dataStart =
      local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    const dataEnd = dataStart + compressedSize;
    if (
      dataEnd > directoryStart ||
      !nameBytes.equals(
        bytes.subarray(local + 30, local + 30 + localNameLength),
      ) ||
      ranges.some(([start, finish]) => local < finish && dataEnd > start)
    )
      throw new ResumeUploadError(
        "This DOCX entry overlaps or exceeds its file data.",
      );
    ranges.push([local, dataEnd]);
    // With a data descriptor, local sizes and CRC may be zero; otherwise both headers must agree.
    for (const [localOffset, expected] of [
      [14, bytes.readUInt32LE(cursor + 16)],
      [18, compressedSize],
      [22, declaredSize],
    ] as const) {
      const actual = bytes.readUInt32LE(local + localOffset);
      if (actual !== expected && (!(flags & 8) || actual !== 0))
        throw new ResumeUploadError(
          "This DOCX local and central headers disagree.",
        );
    }
    let content: Buffer;
    try {
      content =
        method === 0
          ? bytes.subarray(dataStart, dataEnd)
          : inflateRawSync(bytes.subarray(dataStart, dataEnd), {
              maxOutputLength: Math.max(1, MAX_DOCX_EXPANDED_BYTES - expanded),
            });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ERR_BUFFER_TOO_LARGE"
      )
        throw new ResumeUploadError(
          "This DOCX expands beyond the supported size.",
          413,
        );
      throw new ResumeUploadError("This DOCX compressed entry is corrupt.");
    }
    expanded += content.length;
    if (expanded > MAX_DOCX_EXPANDED_BYTES)
      throw new ResumeUploadError(
        "This DOCX expands beyond the supported size.",
        413,
      );
    if (
      content.length !== declaredSize ||
      crc32(content) !== bytes.readUInt32LE(cursor + 16)
    )
      throw new ResumeUploadError(
        "This DOCX entry does not match its size or checksum.",
      );
    hasDocument ||= name === "word/document.xml";
    cursor += entryLength;
  }
  if (cursor !== end || !hasDocument)
    throw new ResumeUploadError("This file is not a valid Word DOCX document.");
}

async function extractPdf(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
    throw new ResumeUploadError("This file is not a valid PDF.");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: true,
  });
  try {
    const document = await task.promise;
    if (document.numPages > 100)
      throw new ResumeUploadError(
        "PDF resumes must contain 100 pages or fewer.",
      );
    const pages: string[] = [];
    let length = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      const text = content.items
        .map((item) =>
          "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
        )
        .join("");
      length += text.length;
      if (length > MAX_RESUME_TEXT_CHARS)
        throw new ResumeUploadError("PDF text is too long.", 413);
      pages.push(text);
    }
    return pages.join("\n\n");
  } catch (error) {
    if (error instanceof ResumeUploadError) throw error;
    if (error instanceof Error && error.name === "PasswordException")
      throw new ResumeUploadError(
        "Encrypted PDFs are not supported. Upload an unencrypted copy.",
      );
    throw new ResumeUploadError(
      "The PDF could not be read. Upload an unencrypted PDF with selectable text.",
    );
  } finally {
    await task.destroy();
  }
}

export async function extractResumeUpload(originalName: string, bytes: Buffer) {
  if (!bytes.length) throw new ResumeUploadError("The uploaded file is empty.");
  if (bytes.length > MAX_RESUME_BYTES)
    throw new ResumeUploadError("Resume files must be 10 MB or smaller.", 413);
  const name = normalizeResumeName(originalName);
  const extension = path.extname(name).toLowerCase();
  const mimeType = MIME_TYPES[extension];
  if (!mimeType)
    throw new ResumeUploadError(
      "Upload a PDF, DOCX, Markdown (.md), or plain-text (.txt) resume.",
    );
  let text: string;
  if (extension === ".pdf") {
    text = await extractPdf(bytes);
  } else if (extension === ".docx") {
    if (bytes.length < 22)
      throw new ResumeUploadError("This DOCX is corrupt or encrypted.");
    validateDocxArchive(bytes);
    try {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } catch {
      throw new ResumeUploadError(
        "The DOCX could not be read. Save an unencrypted DOCX and try again.",
      );
    }
  } else {
    text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes))
      throw new ResumeUploadError("Text resumes must use UTF-8 encoding.");
  }
  if (!text.trim())
    throw new ResumeUploadError(
      "No readable text was found. Scanned PDFs need OCR before upload; OCR is not included.",
    );
  return {
    originalName: name,
    extension,
    mimeType,
    extractedText: validateConfirmedText(text),
  };
}

export async function readLimitedRequestBody(
  request: Request,
  maximumBytes: number,
) {
  if (Number(request.headers.get("content-length")) > maximumBytes)
    throw new ResumeUploadError("Request body is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ResumeUploadError("Request body is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new ResumeUploadError("Request body is too large.", 413);
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks);
}
