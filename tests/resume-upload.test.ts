import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  extractResumeUpload,
  MAX_DOCX_EXPANDED_BYTES,
  MAX_RESUME_BYTES,
  readLimitedRequestBody,
  ResumeUploadError,
  validateConfirmedText,
  validateDocxArchive,
} from "../src/lib/resume/upload";
import {
  readResumeBytes,
  resolveStorageKey,
  storeResumeBytes,
} from "../src/lib/resume/storage";
import {
  isResumeDownloadUrl,
  resumeDownloadUrl,
} from "../src/lib/resume/links";

const fixture = (name: string) =>
  readFile(path.join(process.cwd(), "tests/fixtures/resumes", name));

function singleEntryZip(
  content = Buffer.from("hello"),
  declaredSize = content.length,
  checksum = 0x3610a686,
) {
  const name = Buffer.from("word/document.xml");
  const compressed = deflateRawSync(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(name.length, 26);
  const directoryOffset = local.length + name.length + compressed.length;
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(8, 10);
  directory.writeUInt32LE(checksum, 16);
  directory.writeUInt32LE(compressed.length, 20);
  directory.writeUInt32LE(declaredSize, 24);
  directory.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length + name.length, 12);
  end.writeUInt32LE(directoryOffset, 16);
  return {
    bytes: Buffer.concat([local, name, compressed, directory, name, end]),
    directoryOffset,
  };
}

test("extracts the four supported formats into reviewable text", async () => {
  for (const extension of ["txt", "md", "docx", "pdf"]) {
    const result = await extractResumeUpload(
      `resume.${extension}`,
      await fixture(`resume.${extension}`),
    );
    assert.match(result.extractedText, /Jordan Sample/);
    assert.match(result.extractedText, /SQL/);
    assert.equal(result.extension, `.${extension}`);
  }
});

test("rejects encrypted, corrupt, empty, scanned, wrong-format, oversized, and invalid text uploads", async () => {
  await assert.rejects(
    extractResumeUpload("encrypted.pdf", await fixture("encrypted.pdf")),
    /Encrypted PDF/i,
  );
  await assert.rejects(
    extractResumeUpload("scanned.pdf", await fixture("scanned.pdf")),
    /OCR/,
  );
  await assert.rejects(
    extractResumeUpload("corrupt.pdf", Buffer.from("%PDF-invalid")),
    /could not be read/,
  );
  await assert.rejects(
    extractResumeUpload("corrupt.docx", Buffer.from("bogus")),
    /corrupt/,
  );
  await assert.rejects(
    extractResumeUpload("empty.txt", Buffer.alloc(0)),
    /empty/,
  );
  await assert.rejects(
    extractResumeUpload("empty.md", Buffer.from(" \n")),
    /No readable text/,
  );
  await assert.rejects(
    extractResumeUpload("wrong.pdf", await fixture("resume.docx")),
    /valid PDF/,
  );
  await assert.rejects(
    extractResumeUpload("resume.html", Buffer.from("hello")),
    /Upload a PDF/,
  );
  await assert.rejects(
    extractResumeUpload("huge.txt", Buffer.alloc(MAX_RESUME_BYTES + 1)),
    /10 MB/,
  );
  await assert.rejects(
    extractResumeUpload("binary.txt", Buffer.from([0xff])),
    /UTF-8/,
  );
  await assert.rejects(
    extractResumeUpload("binary.txt", Buffer.from("hello\0world")),
    /binary/,
  );
});

test("rejects DOCX archives with oversized expansion before extraction", async () => {
  const bytes = Buffer.from(await fixture("resume.docx"));
  const index = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(100 * 1024 * 1024, index + 24);
  await assert.rejects(
    extractResumeUpload("bomb.docx", bytes),
    /expands beyond/,
  );
});

test("bounds actual ZIP inflation when both headers understate the expanded size", async () => {
  const { bytes } = singleEntryZip(
    Buffer.alloc(MAX_DOCX_EXPANDED_BYTES + 1, 32),
    1,
    0,
  );
  assert.ok(
    bytes.length < MAX_RESUME_BYTES,
    "the compressed upload passes the upload-size limit",
  );
  await assert.rejects(
    extractResumeUpload("forged-size.docx", bytes),
    (error: unknown) => {
      assert.ok(error instanceof ResumeUploadError);
      assert.equal(error.status, 413);
      assert.match(error.message, /expands beyond/);
      return true;
    },
  );
});

test("validates actual ZIP content and rejects inconsistent central and local headers", () => {
  assert.doesNotThrow(() => validateDocxArchive(singleEntryZip().bytes));
  assert.throws(
    () => validateDocxArchive(singleEntryZip(Buffer.from("hello"), 1).bytes),
    /size or checksum/,
  );
  assert.throws(
    () => validateDocxArchive(singleEntryZip(Buffer.from("hello"), 5, 0).bytes),
    /size or checksum/,
  );
  const cases: Array<
    [string, (bytes: Buffer, directoryOffset: number) => void]
  > = [
    ["local compressed size", (bytes) => bytes.writeUInt32LE(1, 18)],
    ["local expanded size", (bytes) => bytes.writeUInt32LE(1, 22)],
    ["local checksum", (bytes) => bytes.writeUInt32LE(0, 14)],
    ["local compression", (bytes) => bytes.writeUInt16LE(0, 8)],
    ["local flags", (bytes) => bytes.writeUInt16LE(8, 6)],
    [
      "local filename",
      (bytes) => {
        bytes[30] = 0x78;
      },
    ],
    ["local filename length", (bytes) => bytes.writeUInt16LE(0xffff, 26)],
    [
      "local offset inside directory",
      (bytes, offset) => bytes.writeUInt32LE(offset, offset + 42),
    ],
    [
      "central compressed size beyond data",
      (bytes, offset) => bytes.writeUInt32LE(bytes.length, offset + 20),
    ],
    [
      "central filename length",
      (bytes, offset) => bytes.writeUInt16LE(0xffff, offset + 28),
    ],
    [
      "central directory length",
      (bytes) => bytes.writeUInt32LE(0, bytes.length - 10),
    ],
    [
      "central entry count",
      (bytes) => bytes.writeUInt16LE(2, bytes.length - 12),
    ],
    [
      "trailing unlisted data",
      (bytes) => bytes.writeUInt16LE(1, bytes.length - 2),
    ],
  ];
  for (const [name, alter] of cases) {
    const { bytes, directoryOffset } = singleEntryZip();
    alter(bytes, directoryOffset);
    assert.throws(() => validateDocxArchive(bytes), ResumeUploadError, name);
  }
});

test("accepts data-descriptor ZIP headers with omitted local CRC and sizes", () => {
  const original = singleEntryZip();
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50);
  descriptor.writeUInt32LE(original.bytes.readUInt32LE(14), 4);
  descriptor.writeUInt32LE(original.bytes.readUInt32LE(18), 8);
  descriptor.writeUInt32LE(original.bytes.readUInt32LE(22), 12);
  const bytes = Buffer.concat([
    original.bytes.subarray(0, original.directoryOffset),
    descriptor,
    original.bytes.subarray(original.directoryOffset),
  ]);
  const directoryOffset = original.directoryOffset + descriptor.length;
  bytes.writeUInt32LE(directoryOffset, bytes.length - 6);
  bytes.writeUInt16LE(8, 6);
  bytes.writeUInt16LE(8, directoryOffset + 8);
  bytes.fill(0, 14, 26);
  assert.doesNotThrow(() => validateDocxArchive(bytes));
});

test("client filenames never determine disk paths and managed files are private", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "resume-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parsed = await extractResumeUpload(
    "../../private/resume.txt",
    await fixture("resume.txt"),
  );
  assert.equal(parsed.originalName, "resume.txt");
  const key = await storeResumeBytes(
    "originals",
    ".txt",
    Buffer.from(parsed.extractedText),
    root,
  );
  assert.match(key, /^originals\/[a-f0-9-]+\.txt$/);
  assert.equal((await stat(resolveStorageKey(key, root))).mode & 0o777, 0o600);
  assert.equal(
    (await readResumeBytes(key, root)).toString(),
    parsed.extractedText,
  );
  for (const invalid of [
    "../secret.txt",
    "/etc/passwd",
    "originals/../secret.txt",
    "originals/foo.txt",
    "originals/%2e%2e%2fsecret.txt",
  ]) {
    assert.throws(() => resolveStorageKey(invalid, root), /Invalid resume/);
  }
  await rm(resolveStorageKey(key, root));
  await symlink(
    path.join(process.cwd(), "tests/fixtures/resumes/resume.txt"),
    resolveStorageKey(key, root),
  );
  await assert.rejects(readResumeBytes(key, root));
});

test("only managed authenticated download routes become links", () => {
  assert.equal(resumeDownloadUrl("abc123"), "/api/resumes/abc123/download");
  assert.ok(isResumeDownloadUrl("/api/resumes/abc123/download"));
  for (const unsafe of [
    "javascript:alert(1)",
    "https://example.com",
    "/Users/person/resume.md",
    "/api/resumes/../download",
    "/api/resumes/a/download?path=/etc/passwd",
  ])
    assert.equal(isResumeDownloadUrl(unsafe), false);
});

test("bounds request streams even without content length and validates edited text", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: "x".repeat(100),
  });
  await assert.rejects(readLimitedRequestBody(request, 50), /too large/);
  assert.throws(() => validateConfirmedText("  "), /empty/);
  assert.throws(() => validateConfirmedText("x".repeat(200001)), /too long/);
  assert.equal(validateConfirmedText("  Jordan Sample \n"), "Jordan Sample");
});
