import { prisma } from "@/lib/prisma";
import {
  extractResumeUpload,
  ResumeUploadError,
  validateConfirmedText,
} from "./upload";
import {
  removeResumeBytes,
  resumeDownloadUrl,
  storeResumeBytes,
} from "./storage";
import { slugifyResumePart } from "./output";

export const ACTIVE_RESUME_SETTING = "activeResumeId";

export async function createUploadedResume(name: string, bytes: Buffer) {
  // Extraction succeeds before storage or any active-resume mutation.
  const extracted = await extractResumeUpload(name, bytes);
  const storageKey = await storeResumeBytes(
    "originals",
    extracted.extension,
    bytes,
  );
  try {
    return await prisma.resumeFile.create({
      data: {
        kind: "ORIGINAL",
        originalName: extracted.originalName,
        storageKey,
        mimeType: extracted.mimeType,
        size: bytes.length,
        extractedText: extracted.extractedText,
      },
    });
  } catch (error) {
    await removeResumeBytes(storageKey).catch(() => {});
    throw error;
  }
}

export async function confirmResume(id: string, input: unknown, db = prisma) {
  const confirmedText = validateConfirmedText(input);
  return db.$transaction(async (tx) => {
    const resume = await tx.resumeFile.findUnique({ where: { id } });
    if (!resume || resume.kind !== "ORIGINAL")
      throw new ResumeUploadError("Original resume not found.", 404);
    const confirmed = await tx.resumeFile.update({
      where: { id },
      data: { confirmedText, confirmedAt: new Date() },
    });
    await tx.setting.upsert({
      where: { key: ACTIVE_RESUME_SETTING },
      create: { key: ACTIVE_RESUME_SETTING, value: id },
      update: { value: id },
    });
    return confirmed;
  });
}

export async function getActiveResume(db = prisma) {
  const active = await db.setting.findUnique({
    where: { key: ACTIVE_RESUME_SETTING },
  });
  if (!active?.value) return null;
  const resume = await db.resumeFile.findUnique({
    where: { id: active.value },
  });
  return resume?.kind === "ORIGINAL" &&
    resume.confirmedAt &&
    resume.confirmedText?.trim()
    ? resume
    : null;
}

export async function getResumeCapability() {
  if (
    !process.env.GEMINI_API_KEY?.trim() &&
    !process.env.GOOGLE_API_KEY?.trim()
  )
    return {
      enabled: false,
      reason:
        "Resume tailoring is disabled until a Gemini API key is configured.",
    };
  if (!(await getActiveResume()))
    return {
      enabled: false,
      reason: "Upload and confirm your resume in Settings before tailoring.",
    };
  return { enabled: true, reason: null };
}

export async function saveGeneratedResume(input: {
  jobId: string;
  company: string;
  title: string;
  markdown: string;
  now: Date;
}) {
  const bytes = Buffer.from(input.markdown, "utf8");
  const storageKey = await storeResumeBytes("tailored", ".md", bytes);
  const resumeVersion = `${slugifyResumePart(`${input.company}-${input.title}`)}-${input.now.toISOString().replace(/[:.]/g, "-")}`;
  try {
    const file = await prisma.$transaction(async (tx) => {
      const saved = await tx.resumeFile.create({
        data: {
          kind: "TAILORED",
          jobId: input.jobId,
          originalName: `${resumeVersion}.md`,
          storageKey,
          mimeType: "text/markdown; charset=utf-8",
          size: bytes.length,
        },
      });
      await tx.jobTracking.update({
        where: { jobId: input.jobId },
        data: { resumePath: resumeDownloadUrl(saved.id), resumeVersion },
      });
      return saved;
    });
    return { resumePath: resumeDownloadUrl(file.id), resumeVersion };
  } catch (error) {
    await removeResumeBytes(storageKey).catch(() => {});
    throw error;
  }
}
