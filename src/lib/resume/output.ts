import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ResumeTailoringError } from "./errors";

export const TAILORED_RESUME_ROOT =
  process.env.TAILORED_RESUME_ROOT ||
  "/Users/isaaczhu/Isaac's Vault/Jobs/Resumes/Tailored";

export type TailoredResumeDestination = {
  resumePath: string;
  resumeVersion: string;
};

export type TailoredResumeWriteInput = {
  company: string;
  title: string;
  markdown: string;
  now: Date;
  root?: string;
  writeTextFile?: (filePath: string, content: string) => Promise<void>;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatTimestamp(date: Date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-") + `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

export function slugifyResumePart(input: string, maxLength = 90) {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/g, "");

  return slug || "job";
}

function resolveUnderRoot(root: string, relativeParts: string[]) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, ...relativeParts);

  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new ResumeTailoringError(
      "OUTPUT_WRITE_FAILED",
      "Generated resume path escaped the tailored resume root.",
    );
  }

  return resolvedPath;
}

export function createTailoredResumeDestination({
  company,
  title,
  now,
  root = TAILORED_RESUME_ROOT,
  suffix = "",
}: {
  company: string;
  title: string;
  now: Date;
  root?: string;
  suffix?: string;
}): TailoredResumeDestination {
  const timestamp = formatTimestamp(now);
  const year = String(now.getFullYear());
  const month = pad2(now.getMonth() + 1);
  const baseSlug = slugifyResumePart(`${company}-${title}`);
  const resumeVersion = `${baseSlug}-${timestamp}${suffix}`;
  const fileName = `${resumeVersion}.md`;

  return {
    resumeVersion,
    resumePath: resolveUnderRoot(root, [year, month, fileName]),
  };
}

async function defaultWriteTextFile(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, { flag: "wx" });
}

function isFileExistsError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

export async function writeTailoredResumeFile({
  company,
  title,
  markdown,
  now,
  root = TAILORED_RESUME_ROOT,
  writeTextFile = defaultWriteTextFile,
}: TailoredResumeWriteInput): Promise<TailoredResumeDestination> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const destination = createTailoredResumeDestination({
      company,
      title,
      now,
      root,
      suffix,
    });

    try {
      await writeTextFile(destination.resumePath, markdown);
      return destination;
    } catch (error) {
      lastError = error;

      if (!isFileExistsError(error)) {
        throw new ResumeTailoringError(
          "OUTPUT_WRITE_FAILED",
          "The tailored resume was generated but could not be saved.",
          error,
        );
      }
    }
  }

  throw new ResumeTailoringError(
    "OUTPUT_WRITE_FAILED",
    "The tailored resume was generated but could not be saved.",
    lastError,
  );
}
