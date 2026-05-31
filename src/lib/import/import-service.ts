import { ImportRunStatus, type Job, Prisma, Priority } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  buildDedupeInfo,
  dedupeIncomingJobs,
  type DedupeInfo,
} from "./dedupe";
import {
  formatZodError,
  importPayloadSchema,
  minimumImportEnvelopeSchema,
  parseDateOnly,
  type ParsedImportJob,
} from "./validation";

type PrismaClientLike = typeof defaultPrisma;
type TransactionClient = Prisma.TransactionClient;

type PreparedImportJob = {
  data: ParsedImportJob;
  raw: unknown;
  dedupe: DedupeInfo;
};

export type ImportJobsResult =
  | {
      ok: true;
      importRunId: string;
      status: typeof ImportRunStatus.SUCCESS;
      receivedJobs: number;
      importedJobs: number;
      skippedDuplicateRows: number;
      createdJobs: number;
      updatedJobs: number;
      recommendationsCreated: number;
    }
  | {
      ok: false;
      importRunId?: string;
      status?: typeof ImportRunStatus.FAILED;
      errorKind: "validation" | "processing";
      errorMessage: string;
      validationErrors?: string[];
    };

export class MinimumEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinimumEnvelopeError";
  }
}

function getRawJobs(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "jobs" in payload &&
    Array.isArray(payload.jobs)
  ) {
    return payload.jobs;
  }

  return [];
}

function prepareJobs(payload: unknown) {
  const parsed = importPayloadSchema.parse(payload);
  const rawJobs = getRawJobs(payload);
  const prepared = parsed.jobs.map((job, index) => ({
    data: job,
    raw: rawJobs[index] ?? job,
    dedupe: buildDedupeInfo({
      company: job.company,
      title: job.title,
      location: job.location,
      sourceUrl: job.source_url,
    }),
  }));

  return {
    parsed,
    prepared,
    deduped: dedupeIncomingJobs(prepared),
  };
}

async function findExistingJob(
  tx: TransactionClient,
  dedupe: DedupeInfo,
  options: { allowFallbackMatch: boolean },
): Promise<Job | null> {
  if (dedupe.urlKey) {
    const urlMatch = await tx.job.findUnique({
      where: { dedupeKey: dedupe.urlKey },
    });

    if (urlMatch) {
      return urlMatch;
    }
  } else if (options.allowFallbackMatch) {
    const fallbackKeyMatch = await tx.job.findUnique({
      where: { dedupeKey: dedupe.fallbackKey },
    });

    if (fallbackKeyMatch) {
      return fallbackKeyMatch;
    }
  }

  if (!options.allowFallbackMatch) {
    return null;
  }

  const fallbackMatches = await tx.job.findMany({
    where: { fallbackDedupeKey: dedupe.fallbackKey },
    orderBy: { createdAt: "asc" },
    take: 2,
  });

  if (fallbackMatches.length === 1) {
    return fallbackMatches[0];
  }

  return null;
}

function getPriority(priority: Priority | null | undefined) {
  return priority ?? null;
}

function getDatePosted(job: ParsedImportJob) {
  return job.date_posted ? parseDateOnly(job.date_posted) : null;
}

function getJobUpdateData(existingJob: Job, job: PreparedImportJob) {
  const shouldBackfillUrl =
    Boolean(job.dedupe.urlKey) && existingJob.dedupeKey === job.dedupe.fallbackKey;

  return {
    title: job.data.title,
    company: job.data.company,
    location: job.data.location ?? undefined,
    remoteType: job.data.remote_type ?? undefined,
    salaryMin: job.data.salary_min ?? undefined,
    salaryMax: job.data.salary_max ?? undefined,
    description: job.data.description ?? undefined,
    sourceUrl: shouldBackfillUrl ? job.data.source_url : undefined,
    normalizedSourceUrl: shouldBackfillUrl
      ? job.dedupe.normalizedSourceUrl
      : undefined,
    dedupeKey: shouldBackfillUrl ? job.dedupe.urlKey ?? undefined : undefined,
    datePosted: getDatePosted(job.data) ?? undefined,
    lastImportedAt: new Date(),
  };
}

async function upsertJobForImport(
  tx: TransactionClient,
  job: PreparedImportJob,
  options: { allowFallbackMatch: boolean },
) {
  const existingJob = await findExistingJob(tx, job.dedupe, options);

  if (existingJob) {
    const updatedJob = await tx.job.update({
      where: { id: existingJob.id },
      data: getJobUpdateData(existingJob, job),
    });

    return { job: updatedJob, created: false };
  }

  const createdJob = await tx.job.create({
    data: {
      title: job.data.title,
      company: job.data.company,
      location: job.data.location,
      remoteType: job.data.remote_type,
      salaryMin: job.data.salary_min,
      salaryMax: job.data.salary_max,
      description: job.data.description,
      sourceUrl: job.data.source_url,
      normalizedSourceUrl: job.dedupe.normalizedSourceUrl,
      datePosted: getDatePosted(job.data),
      dedupeKey: job.dedupe.urlKey ?? job.dedupe.fallbackKey,
      fallbackDedupeKey: job.dedupe.fallbackKey,
      tracking: {
        create: {},
      },
    },
  });

  return { job: createdJob, created: true };
}

async function processImportRun(
  tx: TransactionClient,
  importRunId: string,
  jobs: PreparedImportJob[],
) {
  let createdJobs = 0;
  let updatedJobs = 0;
  let recommendationsCreated = 0;
  const urlFallbackKeysSeenInThisRun = new Set<string>();

  for (const job of jobs) {
    const allowFallbackMatch =
      !job.dedupe.urlKey ||
      !urlFallbackKeysSeenInThisRun.has(job.dedupe.fallbackKey);
    const result = await upsertJobForImport(tx, job, { allowFallbackMatch });

    if (result.created) {
      createdJobs += 1;
    } else {
      updatedJobs += 1;
    }

    await tx.jobRecommendation.create({
      data: {
        jobId: result.job.id,
        importRunId,
        fitScore: job.data.fit_score,
        priority: getPriority(job.data.priority),
        matchedSkills: job.data.matched_skills,
        missingSkills: job.data.missing_skills,
        matchReason: job.data.match_reason,
        concerns: job.data.concerns,
        suggestedAction: job.data.suggested_action,
        rawRecommendation: job.raw as Prisma.InputJsonValue,
      },
    });
    recommendationsCreated += 1;

    if (job.dedupe.urlKey) {
      urlFallbackKeysSeenInThisRun.add(job.dedupe.fallbackKey);
    }
  }

  return { createdJobs, updatedJobs, recommendationsCreated };
}

export async function importJobsPayload(
  payload: unknown,
  db: PrismaClientLike = defaultPrisma,
): Promise<ImportJobsResult> {
  const envelope = minimumImportEnvelopeSchema.safeParse(payload);

  if (!envelope.success) {
    throw new MinimumEnvelopeError(formatZodError(envelope.error));
  }

  const importRun = await db.importRun.create({
    data: {
      runDate: parseDateOnly(envelope.data.run_date),
      rawPayload: payload as Prisma.InputJsonValue,
      status: ImportRunStatus.PENDING,
    },
  });

  const fullPayload = importPayloadSchema.safeParse(payload);

  if (!fullPayload.success) {
    const errorMessage = formatZodError(fullPayload.error);

    await db.importRun.update({
      where: { id: importRun.id },
      data: {
        status: ImportRunStatus.FAILED,
        errorMessage,
      },
    });

    return {
      ok: false,
      importRunId: importRun.id,
      status: ImportRunStatus.FAILED,
      errorKind: "validation",
      errorMessage,
      validationErrors: fullPayload.error.issues.map((issue) => issue.message),
    };
  }

  try {
    const { parsed, prepared, deduped } = prepareJobs(payload);
    const stats = await db.$transaction(async (tx) => {
      const importStats = await processImportRun(tx, importRun.id, deduped);

      await tx.importRun.update({
        where: { id: importRun.id },
        data: {
          sourceName: parsed.source_name,
          status: ImportRunStatus.SUCCESS,
        },
      });

      return importStats;
    });

    return {
      ok: true,
      importRunId: importRun.id,
      status: ImportRunStatus.SUCCESS,
      receivedJobs: prepared.length,
      importedJobs: deduped.length,
      skippedDuplicateRows: prepared.length - deduped.length,
      ...stats,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Import failed unexpectedly.";

    await db.importRun.update({
      where: { id: importRun.id },
      data: {
        status: ImportRunStatus.FAILED,
        errorMessage,
      },
    });

    return {
      ok: false,
      importRunId: importRun.id,
      status: ImportRunStatus.FAILED,
      errorKind: "processing",
      errorMessage,
    };
  }
}
