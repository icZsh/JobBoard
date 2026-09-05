import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { ResumeUploadError } from "./upload";

const KEY = /^(originals|tailored)\/[a-f0-9-]{36}\.(pdf|docx|md|txt)$/;
export function resumeDataRoot() {
  return path.resolve(process.env.DATA_DIR || "./data", "resumes");
}

export function resolveStorageKey(key: string, root = resumeDataRoot()) {
  if (!KEY.test(key))
    throw new ResumeUploadError("Invalid resume file reference.");
  return path.join(root, key);
}

async function checkedDirectory(directory: string) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new ResumeUploadError(
      "Resume storage is not a regular directory.",
      500,
    );
}

export async function storeResumeBytes(
  kind: "originals" | "tailored",
  extension: string,
  bytes: Buffer,
  root = resumeDataRoot(),
) {
  const storageKey = `${kind}/${randomUUID()}${extension}`;
  const destination = resolveStorageKey(storageKey, root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await checkedDirectory(root);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await checkedDirectory(path.dirname(destination));
  const temporary = `${destination}.tmp`;
  const file = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return storageKey;
}

export async function readResumeBytes(
  storageKey: string,
  root = resumeDataRoot(),
) {
  const destination = resolveStorageKey(storageKey, root);
  await checkedDirectory(root);
  await checkedDirectory(path.dirname(destination));
  const file = await open(
    destination,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 10 * 1024 * 1024)
      throw new ResumeUploadError("Resume file is unavailable.", 404);
    return await file.readFile();
  } finally {
    await file.close();
  }
}

export async function removeResumeBytes(
  storageKey: string,
  root = resumeDataRoot(),
) {
  const destination = resolveStorageKey(storageKey, root);
  await checkedDirectory(root);
  await checkedDirectory(path.dirname(destination));
  await unlink(destination);
}

export { resumeDownloadUrl, isResumeDownloadUrl } from "./links";
