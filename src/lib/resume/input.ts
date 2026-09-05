import path from "node:path";
import { ResumeTailoringError } from "./errors";

const TEXT_RESUME_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const CONTROL_CHAR_REGEX = /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g;
const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function assertTextResumePath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (!TEXT_RESUME_EXTENSIONS.has(extension)) {
    throw new ResumeTailoringError(
      "RESUME_NOT_TEXT",
      "Resume tailoring currently requires a Markdown or plain-text resume. Use the .md resume path, not a PDF.",
    );
  }
}

export function hasLikelyBinaryContent(text: string) {
  if (text.includes("\u0000")) {
    return true;
  }

  const replacementCharacters = (text.match(/\ufffd/g) ?? []).length;
  const controlCharacters = (text.match(CONTROL_CHAR_REGEX) ?? []).length;
  const suspiciousCharacters = replacementCharacters + controlCharacters;

  return text.length > 0 && suspiciousCharacters / text.length > 0.08;
}

export function assertUsableResumeText(text: string) {
  if (hasLikelyBinaryContent(text)) {
    throw new ResumeTailoringError(
      "RESUME_NOT_TEXT",
      "Resume tailoring currently requires a Markdown or plain-text resume. Use the .md resume path, not a PDF.",
    );
  }

  if (text.trim().length === 0) {
    throw new ResumeTailoringError(
      "RESUME_UNREADABLE",
      "The configured resume file could not be read.",
    );
  }
}

function decodeHtmlEntities(text: string) {
  return text.replace(/&(#\d+|#x[a-f0-9]+|[a-z]+);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();

    if (lower.startsWith("#x")) {
      const value = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
    }

    if (lower.startsWith("#")) {
      const value = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
    }

    return HTML_ENTITY_MAP[lower] ?? entity;
  });
}

export function stripHtmlForPrompt(html: string | null | undefined) {
  if (!html) {
    return "";
  }

  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function capPromptText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

export function normalizeResumeForPrompt(text: string, maxChars = 30_000) {
  assertUsableResumeText(text);
  return capPromptText(text.trim(), maxChars);
}

export function normalizeJobDescriptionForPrompt(
  html: string | null | undefined,
  maxChars = 12_000,
) {
  return capPromptText(stripHtmlForPrompt(html), maxChars);
}
