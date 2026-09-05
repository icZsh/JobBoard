import { ImportRunStatus, type Job, Prisma, Priority } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  buildDedupeInfo,
  dedupeIncomingJobs,
  type DedupeInfo,
} from "./dedupe";
import {
  importJobSchema,
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

type PreviewImportJob = PreparedImportJob & {
  index: number;
};

type ImportPreviewRow = ImportPreviewResult["rows"][number];

export interface ImportOptions {
  idempotencyKey?: string;
  /** The self-hosted worker checks its session lock before an import can commit. */
  assertLease?: () => Promise<void>;
}

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

export type ImportPreviewResult = {
  ok: true;
  canImport: boolean;
  runDate: string;
  sourceName: string | null;
  totalJobs: number;
  validJobs: number;
  invalidJobs: number;
  inPayloadDuplicates: number;
  wouldImportJobs: number;
  newJobs: number;
  duplicateJobs: number;
  validationErrors: { path: string; message: string }[];
  rows: {
    index: number;
    title: string | null;
    company: string | null;
    sourceUrl: string | null;
    fitScore: number | null;
    duplicateInPayload: boolean;
    existingJobId: string | null;
    wouldCreate: boolean | null;
    errors: string[];
  }[];
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

function getSourceName(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "source_name" in payload
  ) {
    const sourceNameValue = (payload as Record<string, unknown>).source_name;

    if (typeof sourceNameValue !== "string") {
      return null;
    }

    const sourceName = sourceNameValue.trim();
    return sourceName.length > 0 ? sourceName : null;
  }

  return null;
}

function getRawStringField(raw: unknown, key: string) {
  if (raw && typeof raw === "object" && key in raw) {
    const value = (raw as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  }

  return null;
}

function getRawNumberField(raw: unknown, key: string) {
  if (raw && typeof raw === "object" && key in raw) {
    const value = (raw as Record<string, unknown>)[key];
    return typeof value === "number" ? value : null;
  }

  return null;
}

function formatIssuePath(path: PropertyKey[]) {
  return path.length > 0 ? path.join(".") : "payload";
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

export async function previewImportPayload(
  payload: unknown,
  db: PrismaClientLike = defaultPrisma,
): Promise<ImportPreviewResult> {
  const envelope = minimumImportEnvelopeSchema.safeParse(payload);

  if (!envelope.success) {
    throw new MinimumEnvelopeError(formatZodError(envelope.error));
  }

  const rawJobs = getRawJobs(payload);
  const fullPayload = importPayloadSchema.safeParse(payload);
  const validationErrors = fullPayload.success
    ? []
    : fullPayload.error.issues.map((issue) => ({
        path: formatIssuePath(issue.path),
        message: issue.message,
      }));
  const prepared: PreviewImportJob[] = [];
  const rows: ImportPreviewRow[] = rawJobs.map((raw, index) => {
    const parsed = importJobSchema.safeParse(raw);
    const baseRow: ImportPreviewRow = {
      index: index + 1,
      title: getRawStringField(raw, "title"),
      company: getRawStringField(raw, "company"),
      sourceUrl: getRawStringField(raw, "source_url"),
      fitScore: getRawNumberField(raw, "fit_score"),
      duplicateInPayload: false,
      existingJobId: null,
      wouldCreate: null,
      errors: [] as string[],
    };

    if (!parsed.success) {
      return {
        ...baseRow,
        errors: parsed.error.issues.map(
          (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`,
        ),
      };
    }

    const dedupe = buildDedupeInfo({
      company: parsed.data.company,
      title: parsed.data.title,
      location: parsed.data.location,
      sourceUrl: parsed.data.source_url,
    });

    prepared.push({
      index,
      data: parsed.data,
      raw,
      dedupe,
    });

    return {
      ...baseRow,
      title: parsed.data.title,
      company: parsed.data.company,
      sourceUrl: parsed.data.source_url ?? null,
      fitScore: parsed.data.fit_score ?? null,
      errors: [],
    };
  });

  const deduped = dedupeIncomingJobs(prepared);
  const dedupedIndexes = new Set(deduped.map((job) => job.index));

  for (const job of prepared) {
    if (!dedupedIndexes.has(job.index)) {
      rows[job.index].duplicateInPayload = true;
      rows[job.index].wouldCreate = false;
    }
  }

  const existingMatches = await db.$transaction(async (tx) => {
    const matches = new Map<number, string | null>();
    const urlFallbackKeysSeenInThisRun = new Set<string>();

    for (const job of deduped) {
      const allowFallbackMatch =
        !job.dedupe.urlKey ||
        !urlFallbackKeysSeenInThisRun.has(job.dedupe.fallbackKey);
      const existingJob = await findExistingJob(tx, job.dedupe, {
        allowFallbackMatch,
      });

      matches.set(job.index, existingJob?.id ?? null);

      if (job.dedupe.urlKey) {
        urlFallbackKeysSeenInThisRun.add(job.dedupe.fallbackKey);
      }
    }

    return matches;
  });

  let duplicateJobs = 0;

  for (const job of deduped) {
    const existingJobId = existingMatches.get(job.index) ?? null;
    rows[job.index].existingJobId = existingJobId;
    rows[job.index].wouldCreate = !existingJobId;

    if (existingJobId) {
      duplicateJobs += 1;
    }
  }

  return {
    ok: true,
    canImport: fullPayload.success,
    runDate: envelope.data.run_date,
    sourceName: getSourceName(payload),
    totalJobs: rawJobs.length,
    validJobs: prepared.length,
    invalidJobs: rows.filter((row) => row.errors.length > 0).length,
    inPayloadDuplicates: prepared.length - deduped.length,
    wouldImportJobs: deduped.length,
    newJobs: deduped.length - duplicateJobs,
    duplicateJobs,
    validationErrors,
    rows,
  };
}

export async function importJobsPayload(
  payload: unknown,
  db: PrismaClientLike = defaultPrisma,
  options: ImportOptions = {},
): Promise<ImportJobsResult> {
  const envelope = minimumImportEnvelopeSchema.safeParse(payload);

  if (!envelope.success) {
    throw new MinimumEnvelopeError(formatZodError(envelope.error));
  }

  if (options.idempotencyKey !== undefined) {
    return importIdempotently(payload, db, options);
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function savedSuccessfulResult(value: Prisma.JsonValue | null, importRunId: string): Extract<ImportJobsResult, { ok: true }> {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.ok !== true || value.status !== ImportRunStatus.SUCCESS || value.importRunId !== importRunId) {
    throw new Error("Saved import result is invalid; refusing to repeat a successful import");
  }
  for (const field of ["receivedJobs", "importedJobs", "skippedDuplicateRows", "createdJobs", "updatedJobs", "recommendationsCreated"] as const) {
    if (typeof value[field] !== "number" || !Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new Error("Saved import counts are invalid; refusing to repeat a successful import");
    }
  }
  const result = value as Extract<ImportJobsResult, { ok: true }>;
  if (result.createdJobs + result.updatedJobs !== result.importedJobs || result.recommendationsCreated !== result.importedJobs || result.receivedJobs - result.skippedDuplicateRows !== result.importedJobs) {
    throw new Error("Saved import counts are inconsistent; refusing to repeat a successful import");
  }
  return result;
}

async function importIdempotently(payload: unknown, db: PrismaClientLike, options: ImportOptions): Promise<ImportJobsResult> {
  const key = options.idempotencyKey!;
  if (!key.trim() || key.length > 256) throw new Error("Import idempotency key must contain 1–256 characters");
  const envelope = minimumImportEnvelopeSchema.parse(payload);
  try {
    return await db.$transaction(async (tx) => {
      // Lock and all writes share one transaction: disconnect/rollback releases it automatically.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`jobboard:import:${key}`}, 0))`;
      await options.assertLease?.();
      const existing = await tx.importRun.findUnique({ where: { idempotencyKey: key } });
      if (existing && canonicalJson(existing.rawPayload) !== canonicalJson(payload)) throw new Error("Idempotency key already belongs to a different payload");
      if (existing?.status === ImportRunStatus.SUCCESS) {
        return savedSuccessfulResult(existing.result, existing.id);
      }
      const run = existing ?? await tx.importRun.create({ data: {
        idempotencyKey: key, runDate: parseDateOnly(envelope.run_date), rawPayload: payload as Prisma.InputJsonValue,
        sourceName: getSourceName(payload), status: ImportRunStatus.PENDING,
      } });
      const validated = importPayloadSchema.safeParse(payload);
      if (!validated.success) {
        const result: ImportJobsResult = {
          ok: false, importRunId: run.id, status: ImportRunStatus.FAILED, errorKind: "validation",
          errorMessage: formatZodError(validated.error), validationErrors: validated.error.issues.map((issue) => issue.message),
        };
        await options.assertLease?.();
        await tx.importRun.update({ where: { id: run.id }, data: { status: ImportRunStatus.FAILED, errorMessage: result.errorMessage, result } });
        return result;
      }
      if (existing && await tx.jobRecommendation.count({ where: { importRunId: run.id } })) {
        throw new Error("Unfinished import already has recommendations; manual reconciliation is required");
      }
      const { prepared, deduped } = prepareJobs(payload);
      const stats = await processImportRun(tx, run.id, deduped);
      const result: ImportJobsResult = {
        ok: true, importRunId: run.id, status: ImportRunStatus.SUCCESS,
        receivedJobs: prepared.length, importedJobs: deduped.length, skippedDuplicateRows: prepared.length - deduped.length, ...stats,
      };
      await options.assertLease?.();
      await tx.importRun.update({ where: { id: run.id }, data: { status: ImportRunStatus.SUCCESS, errorMessage: null, result } });
      return result;
    }, { maxWait: 15000, timeout: 60000 });
  } catch (error) {
    // A processing failure rolls back the entire keyed import. Retrying this exact key and payload is safe.
    return { ok: false, errorKind: "processing", errorMessage: error instanceof Error ? error.message : "Import failed unexpectedly" };
  }
}
