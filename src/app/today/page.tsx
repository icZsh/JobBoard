import Link from "next/link";
import { ImportRunStatus, JobStatus } from "@/generated/prisma/client";
import { formatDateOnly, formatSalary, formatTimestamp } from "@/lib/format";
import { parseJobDescriptionSections } from "@/lib/jobs/description";
import { isApplyTodayJob } from "@/lib/jobs/prioritization";
import {
  getFitTier,
  getSalarySortValue,
  priorityBadgeClass,
  statusHueByStatus,
} from "@/lib/jobs/view";
import { prisma } from "@/lib/prisma";
import { getHighFitThreshold } from "@/lib/settings";
import { TodayClient, type TodayJobItem } from "./today-client";

export const dynamic = "force-dynamic";

type TodaySearchParams = Promise<{
  includeHidden?: string | string[];
  runId?: string | string[];
}>;

type TodayPageProps = {
  searchParams: TodaySearchParams;
};

const hiddenStatuses = new Set<string>([JobStatus.PASSED, JobStatus.ARCHIVED]);

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildTodayHref(input: { includeHidden?: boolean; runId?: string }) {
  const params = new URLSearchParams();

  if (input.includeHidden) {
    params.set("includeHidden", "1");
  }

  if (input.runId) {
    params.set("runId", input.runId);
  }

  const query = params.toString();
  return query ? `/today?${query}` : "/today";
}

async function getLatestRunOverall() {
  return prisma.importRun.findFirst({
    orderBy: [{ runDate: "desc" }, { createdAt: "desc" }],
  });
}

async function getNextSuccessfulRunBefore(createdAt: Date, runDate: Date) {
  return prisma.importRun.findFirst({
    where: {
      status: ImportRunStatus.SUCCESS,
      OR: [
        { runDate: { lt: runDate } },
        {
          runDate,
          createdAt: { lt: createdAt },
        },
      ],
    },
    orderBy: [{ runDate: "desc" }, { createdAt: "desc" }],
  });
}

async function getRequestedSuccessfulRun(runId: string | undefined) {
  if (!runId) {
    return null;
  }

  return prisma.importRun.findFirst({
    where: { id: runId, status: ImportRunStatus.SUCCESS },
  });
}

async function getRecommendationsForRun(runId: string) {
  return prisma.jobRecommendation.findMany({
    where: { importRunId: runId },
    include: {
      job: {
        include: {
          tracking: true,
        },
      },
    },
    orderBy: [{ fitScore: "desc" }, { createdAt: "asc" }],
  });
}

type RecommendationWithJob = Awaited<
  ReturnType<typeof getRecommendationsForRun>
>[number];

function toTodayItem(recommendation: RecommendationWithJob): TodayJobItem {
  const job = recommendation.job;
  const status = job.tracking?.status ?? JobStatus.NEW;
  const descriptionSections = parseJobDescriptionSections(job.description);

  return {
    recommendationId: recommendation.id,
    jobId: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    remoteType: job.remoteType,
    salary: formatSalary(job.salaryMin, job.salaryMax),
    salarySort: getSalarySortValue(job.salaryMin, job.salaryMax),
    sourceUrl: job.sourceUrl,
    status,
    statusHue: statusHueByStatus[status],
    fitScore: recommendation.fitScore,
    fitTier: getFitTier(recommendation.fitScore),
    priority: recommendation.priority,
    priorityClass: priorityBadgeClass(recommendation.priority),
    suggestedAction: recommendation.suggestedAction,
    datePosted: job.datePosted ? formatDateOnly(job.datePosted) : "Unknown",
    companyOverview: descriptionSections.company,
    benefitsOverview: descriptionSections.benefits,
    roleOverview: descriptionSections.role ?? descriptionSections.legacy,
    matchReason: recommendation.matchReason,
    concerns: recommendation.concerns,
    matchedSkills: recommendation.matchedSkills,
    missingSkills: recommendation.missingSkills,
  };
}

function sortInitialItems(items: TodayJobItem[], highFitThreshold: number) {
  return [...items].sort((left, right) => {
    const leftApply = isApplyTodayJob({
      fitScore: left.fitScore,
      concerns: left.concerns,
      status: left.status,
      suggestedAction: left.suggestedAction,
      highFitThreshold,
    });
    const rightApply = isApplyTodayJob({
      fitScore: right.fitScore,
      concerns: right.concerns,
      status: right.status,
      suggestedAction: right.suggestedAction,
      highFitThreshold,
    });

    if (leftApply !== rightApply) {
      return leftApply ? -1 : 1;
    }

    return (right.fitScore ?? -1) - (left.fitScore ?? -1);
  });
}

function getApplyTodayCount(items: TodayJobItem[], highFitThreshold: number) {
  return items.filter(
    (item) =>
      !hiddenStatuses.has(item.status) &&
      isApplyTodayJob({
        fitScore: item.fitScore,
        concerns: item.concerns,
        status: item.status,
        suggestedAction: item.suggestedAction,
        highFitThreshold,
      }),
  ).length;
}

function EmptyState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="paper-card paper-empty">
      <h2 className="text-lg font-bold text-[var(--ink)]">{title}</h2>
      <div className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
        {children}
      </div>
    </div>
  );
}

export default async function TodayPage({ searchParams }: TodayPageProps) {
  const params = await searchParams;
  const includeHidden = getSingleParam(params.includeHidden) === "1";
  const requestedRunId = getSingleParam(params.runId);
  const [latestRunOverall, requestedRun, highFitThreshold] = await Promise.all([
    getLatestRunOverall(),
    getRequestedSuccessfulRun(requestedRunId),
    getHighFitThreshold(),
  ]);
  const selectedRun =
    requestedRun ??
    (latestRunOverall?.status === ImportRunStatus.SUCCESS
      ? latestRunOverall
      : null);
  const nextSuccessfulRun =
    !requestedRun && latestRunOverall?.status === ImportRunStatus.FAILED
      ? await getNextSuccessfulRunBefore(
          latestRunOverall.createdAt,
          latestRunOverall.runDate,
        )
      : null;
  const recommendations = selectedRun
    ? await getRecommendationsForRun(selectedRun.id)
    : [];
  const items = sortInitialItems(
    recommendations.map(toTodayItem),
    highFitThreshold,
  );
  const totalRecommendations = items.length;
  const applyTodayCount = getApplyTodayCount(items, highFitThreshold);
  const subline = selectedRun
    ? `${formatDateOnly(selectedRun.runDate)} · ${applyTodayCount} to apply today`
    : "Latest recommendations will appear here after an import.";

  return (
    <main className="paper-app">
      <div className="paper-wrap">
        <header className="paper-head">
          <div>
            <p className="paper-eyebrow">Daily Review</p>
            <h1 className="paper-title">Today</h1>
            <p className="paper-sub">
              {selectedRun ? (
                <>
                  {formatDateOnly(selectedRun.runDate)} ·{" "}
                  <strong>{applyTodayCount} to apply today</strong>
                </>
              ) : (
                subline
              )}
            </p>
          </div>

          <div className="paper-actions">
            <Link className="paper-btn" href="/import">
              Import
            </Link>
            <Link className="paper-btn" href="/board">
              Board
            </Link>
            <Link className="paper-btn" href="/settings">
              Settings
            </Link>
          </div>
        </header>

        {latestRunOverall?.status === ImportRunStatus.FAILED && !requestedRun ? (
          <EmptyState title="Latest import failed">
            <p>{latestRunOverall.errorMessage ?? "No error message was saved."}</p>
            {nextSuccessfulRun ? (
              <Link
                className="paper-btn mt-4"
                href={buildTodayHref({ runId: nextSuccessfulRun.id })}
              >
                Open Previous Successful Run
              </Link>
            ) : null}
          </EmptyState>
        ) : null}

        {!latestRunOverall ? (
          <EmptyState title="No imports yet">
            <p>Import a daily recommendation payload to start reviewing jobs.</p>
            <Link className="paper-btn mt-4" href="/import">
              Import Jobs
            </Link>
          </EmptyState>
        ) : null}

        {selectedRun && totalRecommendations === 0 ? (
          <EmptyState title="Latest run completed with no jobs">
            <p>Run timestamp: {formatTimestamp(selectedRun.createdAt)}</p>
          </EmptyState>
        ) : null}

        {items.length > 0 ? (
          <TodayClient
            highFitThreshold={highFitThreshold}
            initialShowHidden={includeHidden}
            jobs={items}
          />
        ) : null}
      </div>
    </main>
  );
}
