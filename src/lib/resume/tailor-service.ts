import { readFile, unlink } from "node:fs/promises";
import { getLatestRecommendation } from "@/lib/jobs/recommendations";
import { updateJobTracking } from "@/lib/jobs/tracking";
import { prisma } from "@/lib/prisma";
import { getSettingsValues } from "@/lib/settings";
import { ResumeTailoringError } from "./errors";
import {
  assertTextResumePath,
  normalizeJobDescriptionForPrompt,
  normalizeResumeForPrompt,
} from "./input";
import { writeTailoredResumeFile } from "./output";
import { buildResumeTailoringPrompt } from "./prompt";
import { callGeminiResumeTailor } from "./gemini-client";
import type { TailoredResumeResponse } from "./schema";

const MIN_TAILORED_MARKDOWN_CHARS = 80;

async function defaultGetJob(jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    include: {
      tracking: true,
      recommendations: {
        include: {
          importRun: true,
        },
      },
    },
  });
}

type ResumeTailoringRecommendation = {
  fitScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  matchReason: string | null;
  concerns: string | null;
  suggestedAction: string | null;
  importRun: {
    runDate: Date;
    createdAt: Date;
  };
};

type ResumeTailoringJob = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  description: string | null;
  sourceUrl: string | null;
  recommendations: ResumeTailoringRecommendation[];
};

type ResumeTailoringSettings = Awaited<ReturnType<typeof getSettingsValues>>;
type TailoredResumeFileWriter = typeof writeTailoredResumeFile;

export type TailorResumeResult = {
  resumePath: string;
  resumeVersion: string;
  warnings: string[];
  changes: string[];
};

export type TailorResumeDeps = {
  now?: () => Date;
  getSettingsValues?: () => Promise<ResumeTailoringSettings>;
  getJob?: (jobId: string) => Promise<ResumeTailoringJob | null>;
  readTextFile?: (filePath: string) => Promise<string>;
  callGemini?: (prompt: string) => Promise<TailoredResumeResponse>;
  writeTailoredResumeFile?: TailoredResumeFileWriter;
  updateTracking?: (
    jobId: string,
    input: { resumePath?: string | null; resumeVersion?: string | null },
  ) => Promise<unknown>;
  deleteTextFile?: (filePath: string) => Promise<void>;
};

async function defaultReadTextFile(filePath: string) {
  return readFile(filePath, "utf8");
}

function recommendationHasContext(
  recommendation: ResumeTailoringJob["recommendations"][number] | null,
) {
  if (!recommendation) {
    return false;
  }

  return Boolean(
    recommendation.fitScore !== null ||
      recommendation.matchedSkills.length > 0 ||
      recommendation.missingSkills.length > 0 ||
      recommendation.matchReason?.trim() ||
      recommendation.concerns?.trim() ||
      recommendation.suggestedAction?.trim(),
  );
}

function ensureTailoredMarkdownQuality(markdown: string) {
  if (markdown.trim().length < MIN_TAILORED_MARKDOWN_CHARS) {
    throw new ResumeTailoringError(
      "GEMINI_INVALID_JSON",
      "Gemini could not generate a valid tailored resume. Try again or check logs.",
    );
  }
}

export async function tailorResumeForJob(
  jobId: string,
  deps: TailorResumeDeps = {},
): Promise<TailorResumeResult> {
  const now = deps.now ?? (() => new Date());
  const loadSettings = deps.getSettingsValues ?? getSettingsValues;
  const loadJob = deps.getJob ?? defaultGetJob;
  const readTextFile = deps.readTextFile ?? defaultReadTextFile;
  const callGemini = deps.callGemini ?? callGeminiResumeTailor;
  const writeFile = deps.writeTailoredResumeFile ?? writeTailoredResumeFile;
  const persistTracking = deps.updateTracking ?? updateJobTracking;
  const deleteTextFile = deps.deleteTextFile ?? unlink;

  const job = await loadJob(jobId);

  if (!job) {
    throw new ResumeTailoringError("JOB_NOT_FOUND", "Job not found.");
  }

  const settings = await loadSettings();
  const resumeFilePath = settings.resumeFilePath.trim();

  if (!resumeFilePath) {
    throw new ResumeTailoringError(
      "RESUME_NOT_CONFIGURED",
      "Configure a Markdown base resume path in Settings before tailoring.",
    );
  }

  assertTextResumePath(resumeFilePath);

  let baseResumeText: string;
  try {
    baseResumeText = await readTextFile(resumeFilePath);
  } catch (error) {
    throw new ResumeTailoringError(
      "RESUME_UNREADABLE",
      "The configured resume file could not be read.",
      error,
    );
  }

  const baseResumeMarkdown = normalizeResumeForPrompt(baseResumeText);
  const latestRecommendation = getLatestRecommendation(job.recommendations);
  const description = normalizeJobDescriptionForPrompt(job.description);

  if (!description && !recommendationHasContext(latestRecommendation)) {
    throw new ResumeTailoringError(
      "NO_JOB_CONTEXT",
      "This job needs a description or recommendation context before tailoring.",
    );
  }

  const prompt = buildResumeTailoringPrompt({
    baseResumeMarkdown,
    job: {
      title: job.title,
      company: job.company,
      location: job.location,
      remoteType: job.remoteType,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      description,
      sourceUrl: job.sourceUrl,
    },
    recommendation: latestRecommendation
      ? {
          fitScore: latestRecommendation.fitScore,
          matchedSkills: latestRecommendation.matchedSkills,
          missingSkills: latestRecommendation.missingSkills,
          matchReason: latestRecommendation.matchReason,
          concerns: latestRecommendation.concerns,
          suggestedAction: latestRecommendation.suggestedAction,
        }
      : null,
  });

  const tailored = await callGemini(prompt);
  ensureTailoredMarkdownQuality(tailored.markdown);

  const written = await writeFile({
    company: job.company,
    title: job.title,
    markdown: tailored.markdown,
    now: now(),
  });

  try {
    await persistTracking(jobId, {
      resumePath: written.resumePath,
      resumeVersion: written.resumeVersion,
    });
  } catch (error) {
    try {
      await deleteTextFile(written.resumePath);
    } catch {
      // Best-effort cleanup only. The thrown error below keeps the UI from reporting success.
    }

    throw new ResumeTailoringError(
      "TRACKING_UPDATE_FAILED",
      "The tailored resume was generated but could not be saved.",
      error,
    );
  }

  return {
    resumePath: written.resumePath,
    resumeVersion: written.resumeVersion,
    warnings: tailored.warnings,
    changes: tailored.changes,
  };
}
