import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCollectionConfig, type SelfHostConfig } from "./config";
import { calendarDate, scheduledSlot } from "./schedule";

export const ACTIVE_RUN_STATUSES = ["QUEUED", "RUNNING", "PUBLISHING"];
export const TERMINAL_RUN_STATUSES = ["SUCCESS", "PARTIAL", "EMPTY", "FAILED"];

export async function queueCollectionRun(
  trigger: "manual" | "scheduled",
  suppliedConfig?: SelfHostConfig,
  scheduledFor?: Date,
) {
  const config = suppliedConfig ?? (await getCollectionConfig());
  if (!config)
    throw new Error(
      "Save collection preferences and at least one source before collecting",
    );
  if (trigger === "scheduled" && (!config.schedule.enabled || !scheduledFor))
    throw new Error(
      "Scheduled collection requires an enabled schedule and due time",
    );
  const slot = scheduledFor
    ? scheduledSlot(
        calendarDate(scheduledFor, config.timezone),
        config.timezone,
        config.schedule.time,
      )
    : null;
  const runKey = trigger === "scheduled" ? slot!.key : `manual:${randomUUID()}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('jobboard:collection:queue', 0))`;
    const existing = await tx.collectionRun.findUnique({ where: { runKey } });
    if (existing) return existing;
    const active = await tx.collectionRun.findFirst({
      where: { status: { in: ACTIVE_RUN_STATUSES } },
      orderBy: { createdAt: "asc" },
    });
    if (active) return active;
    return tx.collectionRun.create({
      data: {
        runKey,
        trigger,
        configSnapshot: config as unknown as Prisma.InputJsonValue,
        scheduledFor: trigger === "scheduled" ? scheduledFor : null,
      },
    });
  });
}

export const enqueueManualRun = () => queueCollectionRun("manual");

export function compactCollectionReport(
  value: Prisma.JsonValue | null,
): Prisma.JsonValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary: Prisma.JsonObject = {};
  for (const key of [
    "version",
    "runDate",
    "fetchedAt",
    "complete",
    "observedCount",
    "eligibleCount",
    "selectedCount",
    "duplicateRows",
    "scoring",
  ]) {
    if (
      value[key] !== undefined &&
      (value[key] === null || typeof value[key] !== "object")
    )
      summary[key] = value[key];
  }
  summary.missingFromFeedCount = Array.isArray(value.missingFromFeed)
    ? value.missingFromFeed.length
    : 0;
  summary.sources = Array.isArray(value.sources)
    ? value.sources.slice(0, 500).flatMap((source) => {
        if (!source || typeof source !== "object" || Array.isArray(source))
          return [];
        return [
          {
            key: String(source.key ?? "").slice(0, 300),
            company: String(source.company ?? "").slice(0, 200),
            status: source.status === "success" ? "success" : "failed",
            postings: typeof source.postings === "number" ? source.postings : 0,
            error:
              source.error === null || source.error === undefined
                ? null
                : String(source.error).slice(0, 2000),
          },
        ];
      })
    : [];
  return summary;
}

export async function getRecentCollectionRuns(limit = 20) {
  const runs = await prisma.collectionRun.findMany({
    take: Math.min(100, Math.max(1, Math.floor(limit))),
    orderBy: { createdAt: "desc" },
    // Full payloads belong to recovery/storage, not the polling response.
    select: {
      id: true,
      runKey: true,
      trigger: true,
      status: true,
      scheduledFor: true,
      startedAt: true,
      finishedAt: true,
      heartbeatAt: true,
      attempts: true,
      report: true,
      error: true,
      importRunId: true,
      createdAt: true,
    },
  });
  return runs.map((run) => ({
    ...run,
    report: compactCollectionReport(run.report),
  }));
}
