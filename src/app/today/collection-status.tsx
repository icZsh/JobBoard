import { prisma } from "@/lib/prisma";
import { getCollectionConfig } from "@/lib/selfhost/config";
import { getRecentCollectionRuns } from "@/lib/selfhost/runs";
import { getNextScheduledSlot } from "@/lib/selfhost/schedule";
import { CollectionStatusClient } from "./collection-status-client";

export async function CollectionStatus() {
  const [config, runs, lastSuccess] = await Promise.all([
    getCollectionConfig(),
    getRecentCollectionRuns(10),
    prisma.collectionRun.findFirst({
      where: { status: { in: ["SUCCESS", "PARTIAL", "EMPTY"] } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);
  if (!config) return null;
  const next = config.schedule.enabled
    ? (getNextScheduledSlot(
        new Date(),
        config.timezone,
        config.schedule.time,
      )?.scheduledFor.toISOString() ?? null)
    : null;
  return (
    <CollectionStatusClient
      timezone={config.timezone}
      nextRun={next}
      lastSuccess={lastSuccess?.finishedAt?.toISOString() ?? null}
      runs={runs.map((run) => ({
        id: run.id,
        status: run.status,
        error: run.error,
        report: run.report,
        createdAt: run.createdAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      }))}
    />
  );
}
