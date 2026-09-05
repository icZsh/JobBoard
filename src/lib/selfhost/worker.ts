import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  collect,
  emptyState,
  parseState,
  type CollectionReport,
} from "@/lib/collector/runner";
import { importJobsPayload } from "@/lib/import/import-service";
import { importPayloadSchema } from "@/lib/import/validation";
import { getCollectionConfig, parseSelfHostConfig } from "./config";
import {
  ACTIVE_RUN_STATUSES,
  queueCollectionRun,
  TERMINAL_RUN_STATUSES,
} from "./runs";
import {
  calendarDate,
  getLatestScheduledSlot,
  shouldQueueScheduledSlot,
} from "./schedule";

const OBSERVATIONS_KEY = "collector_observations";
const MAX_ATTEMPTS = 3;
type Db = typeof prisma;
type CollectionResult = Awaited<ReturnType<typeof collect>>;

export interface WorkerOptions {
  db?: Db;
  dataDir?: string;
  now?: () => Date;
  assertLease?: () => Promise<void>;
  collectFn?: typeof collect;
  importFn?: typeof importJobsPayload;
}

function runDirectory(dataDir: string, id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error("Invalid collection run ID");
  return path.join(path.resolve(dataDir), "collector", "runs", id);
}

async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function saveSnapshots(
  dataDir: string,
  id: string,
  result: CollectionResult,
  config: unknown,
) {
  const directory = runDirectory(dataDir, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const hash = createHash("sha256")
    .update(`${JSON.stringify(result.payload, null, 2)}\n`)
    .digest("hex");
  await atomicJson(path.join(directory, "snapshot.json"), result.snapshot);
  await atomicJson(path.join(directory, "config.json"), config);
  await atomicJson(path.join(directory, "payload.json"), result.payload);
  await atomicJson(path.join(directory, "report.json"), {
    ...result.report,
    payloadSha256: hash,
  });
}

function savedReport(value: Prisma.JsonValue | null): CollectionReport {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.complete !== "boolean" ||
    !Array.isArray(value.sources)
  ) {
    throw new Error(
      "Saved collection report is invalid; refusing to publish unknown evidence",
    );
  }
  for (const source of value.sources) {
    if (
      !source ||
      typeof source !== "object" ||
      Array.isArray(source) ||
      !["success", "failed"].includes(String(source.status))
    )
      throw new Error("Saved source report is invalid");
  }
  return value as unknown as CollectionReport;
}

/** Execute one durable run. Injected collector/import functions are test seams, never environment-controlled network overrides. */
export async function executeCollectionRun(
  id: string,
  options: WorkerOptions = {},
) {
  const db = options.db ?? prisma;
  const now = options.now ?? (() => new Date());
  const dataDir =
    options.dataDir ?? process.env.DATA_DIR ?? path.resolve("data");
  const initial = await db.collectionRun.findUniqueOrThrow({ where: { id } });
  if (!ACTIVE_RUN_STATUSES.includes(initial.status)) return initial;
  await options.assertLease?.();
  const attempt = initial.attempts + 1;
  const claimed = await db.collectionRun.updateMany({
    where: {
      id,
      attempts: initial.attempts,
      status: { in: ACTIVE_RUN_STATUSES },
    },
    data: {
      attempts: attempt,
      status: initial.payload ? "PUBLISHING" : "RUNNING",
      startedAt: initial.startedAt ?? now(),
      heartbeatAt: now(),
      error: null,
    },
  });
  if (claimed.count !== 1)
    throw new Error("Collection run was claimed by another worker");
  let heartbeatError: unknown;
  const guard = async () => {
    if (heartbeatError) throw heartbeatError;
    await options.assertLease?.();
  };
  const update = async (data: Prisma.CollectionRunUncheckedUpdateManyInput) => {
    await guard();
    const result = await db.collectionRun.updateMany({
      where: { id, attempts: attempt, status: { in: ACTIVE_RUN_STATUSES } },
      data,
    });
    if (result.count !== 1)
      throw new Error(
        "Collection run ownership changed; old worker cannot update it",
      );
  };
  let heartbeating = false;
  const heartbeat = setInterval(() => {
    if (heartbeating) return;
    heartbeating = true;
    void update({ heartbeatAt: now() })
      .catch((error: unknown) => {
        heartbeatError = error;
      })
      .finally(() => {
        heartbeating = false;
      });
  }, 10000);
  try {
    const config = parseSelfHostConfig(initial.configSnapshot);
    let payload = initial.payload;
    let report: CollectionReport;
    if (payload) {
      importPayloadSchema.parse(payload);
      report = savedReport(initial.report);
    } else {
      const ledger = await db.setting.findUnique({
        where: { key: OBSERVATIONS_KEY },
      });
      const previousState = ledger
        ? parseState(JSON.parse(ledger.value))
        : emptyState();
      const timestamp = now();
      const result = await (options.collectFn ?? collect)({
        config: config.collector,
        now: timestamp,
        runDate: calendarDate(timestamp, config.timezone),
        previousState,
      });
      await guard();
      await saveSnapshots(dataDir, id, result, config);
      await guard();
      await db.$transaction(async (tx) => {
        const updated = await tx.collectionRun.updateMany({
          where: { id, attempts: attempt, status: "RUNNING" },
          data: {
            status: "PUBLISHING",
            payload: result.payload as unknown as Prisma.InputJsonValue,
            report: result.report as unknown as Prisma.InputJsonValue,
            heartbeatAt: now(),
          },
        });
        if (updated.count !== 1)
          throw new Error(
            "Collection run ownership changed before saving results",
          );
        await tx.setting.upsert({
          where: { key: OBSERVATIONS_KEY },
          create: {
            key: OBSERVATIONS_KEY,
            value: JSON.stringify(result.state),
          },
          update: { value: JSON.stringify(result.state) },
        });
        await guard();
      });
      payload = result.payload as unknown as Prisma.JsonValue;
      report = result.report;
    }
    const successfulSources = report.sources.filter(
      (source) => source.status === "success",
    ).length;
    if (!successfulSources) {
      await update({
        status: "FAILED",
        finishedAt: now(),
        error:
          "All sources failed; the existing JobBoard shortlist was preserved.",
      });
    } else if (importPayloadSchema.parse(payload).jobs.length === 0) {
      await update({ status: "EMPTY", finishedAt: now(), error: null });
    } else {
      await guard();
      const imported = await (options.importFn ?? importJobsPayload)(
        payload,
        db,
        { idempotencyKey: `collection:${id}`, assertLease: guard },
      );
      if (!imported.ok) throw new Error(imported.errorMessage);
      await update({
        status: report.complete ? "SUCCESS" : "PARTIAL",
        importRunId: imported.importRunId,
        finishedAt: now(),
        heartbeatAt: now(),
        error: null,
      });
    }
  } catch (error) {
    // A lost session lock must leave recovery to its successor, never mark the successor's run failed.
    await guard();
    await update({
      status: attempt >= MAX_ATTEMPTS ? "FAILED" : "QUEUED",
      error: (error instanceof Error
        ? error.message
        : "Collection failed"
      ).slice(0, 4000),
      finishedAt: attempt >= MAX_ATTEMPTS ? now() : null,
      heartbeatAt: now(),
    });
  } finally {
    clearInterval(heartbeat);
  }
  return db.collectionRun.findUniqueOrThrow({ where: { id } });
}

/** Delete only raw files of old terminal runs. Database payloads, identities, ledger and summaries remain available for recovery. */
export async function pruneRunSnapshots(
  options: Pick<WorkerOptions, "db" | "dataDir" | "now"> = {},
) {
  const db = options.db ?? prisma;
  const dataDir =
    options.dataDir ?? process.env.DATA_DIR ?? path.resolve("data");
  const cutoff = new Date(
    (options.now?.() ?? new Date()).getTime() - 30 * 86400000,
  );
  const root = path.join(path.resolve(dataDir), "collector", "runs");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const ids = entries
    .filter(
      (entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(entry.name),
    )
    .map((entry) => entry.name);
  for (let offset = 0; offset < ids.length; offset += 100) {
    const expired = await db.collectionRun.findMany({
      where: {
        id: { in: ids.slice(offset, offset + 100) },
        status: { in: TERMINAL_RUN_STATUSES },
        finishedAt: { lt: cutoff },
      },
      select: { id: true },
    });
    for (const run of expired)
      await rm(runDirectory(dataDir, run.id), { recursive: true, force: true });
  }
}

export async function workerTick(options: WorkerOptions = {}) {
  const db = options.db ?? prisma;
  await options.assertLease?.();
  const config = await getCollectionConfig();
  if (config?.schedule.enabled) {
    const slot = getLatestScheduledSlot(
      options.now?.() ?? new Date(),
      config.timezone,
      config.schedule.time,
    );
    const savedConfig = await db.collectionConfig.findUnique({
      where: { id: "default" },
      select: { createdAt: true },
    });
    if (slot && savedConfig) {
      const manual = await db.collectionRun.findFirst({
        where: {
          trigger: "manual",
          status: { in: ["SUCCESS", "PARTIAL", "EMPTY"] },
          finishedAt: { gte: slot.scheduledFor },
        },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      });
      if (
        shouldQueueScheduledSlot(
          slot,
          savedConfig.createdAt,
          manual?.finishedAt,
        )
      )
        await queueCollectionRun("scheduled", config, slot.scheduledFor);
    }
  }
  const run = await db.collectionRun.findFirst({
    where: { status: { in: ACTIVE_RUN_STATUSES } },
    orderBy: { createdAt: "asc" },
  });
  return run ? executeCollectionRun(run.id, options) : null;
}

function pause(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function runWorker(signal?: AbortSignal) {
  const connection = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  let lost: Error | null = null;
  let closing = false;
  connection.on("error", (error) => {
    lost = error;
  });
  connection.on("end", () => {
    if (!closing) lost = new Error("Worker database lock connection closed");
  });
  await connection.connect();
  const lock = await connection.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
    ["jobboard:selfhost:worker"],
  );
  if (!lock.rows[0]?.acquired) {
    await connection.end();
    throw new Error("Another collector worker holds the database session lock");
  }
  const assertLease = async () => {
    if (lost) throw lost;
    if (signal?.aborted) throw new Error("Worker is stopping");
    await connection.query("SELECT 1");
    if (lost) throw lost;
  };
  const healthFile =
    process.env.WORKER_HEALTH_FILE ?? "/tmp/jobboard-worker-heartbeat";
  let checking = false;
  const writeHealth = async () => {
    await assertLease();
    await writeFile(healthFile, Date.now().toString(), { mode: 0o600 });
  };
  const heartbeat = setInterval(() => {
    if (checking) return;
    checking = true;
    void writeHealth()
      .catch((error: unknown) => {
        lost =
          error instanceof Error ? error : new Error("Worker heartbeat failed");
      })
      .finally(() => {
        checking = false;
      });
  }, 10000);
  let lastCleanup = 0;
  try {
    await writeHealth();
    while (!signal?.aborted) {
      await assertLease();
      const run = await workerTick({ assertLease });
      if (run)
        console.log(
          JSON.stringify({
            collectionRunId: run.id,
            status: run.status,
            attempts: run.attempts,
            error: run.error,
          }),
        );
      await writeHealth();
      if (Date.now() - lastCleanup > 3600000) {
        await pruneRunSnapshots();
        lastCleanup = Date.now();
      }
      await pause(15000, signal);
    }
  } finally {
    clearInterval(heartbeat);
    closing = true;
    await connection.end().catch(() => {});
    await prisma.$disconnect();
  }
}
