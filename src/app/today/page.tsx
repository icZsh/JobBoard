import Link from "next/link";
import { ImportRunStatus, JobStatus } from "@/generated/prisma/client";
import {
  formatDateOnly,
  formatPostedAge,
  formatSalary,
  formatTimestamp,
  getLocalDateKey,
  REVIEW_TIME_ZONE,
} from "@/lib/format";
import { getCompanyWebsiteUrl } from "@/lib/jobs/company-website";
import { parseJobDescriptionSections } from "@/lib/jobs/description";
import { isApplyTodayJob } from "@/lib/jobs/prioritization";
import { isRecommendationTrackingEligible, selectRecommendations } from "@/lib/jobs/recommendation-eligibility";
import { findMatchingHistory } from "@/lib/jobs/recommendation-history";
import {
  getFitTier,
  getSalarySortValue,
  priorityBadgeClass,
} from "@/lib/jobs/view";
import { prisma } from "@/lib/prisma";
import { getHighFitThreshold } from "@/lib/settings";
import { RunDateSelect, type RunDateOption } from "./run-date-select";
import { TodayClient, type TodayJobItem } from "./today-client";

export const dynamic = "force-dynamic";

type TodaySearchParams = Promise<{
  includeHidden?: string | string[];
  runId?: string | string[];
}>;

type TodayPageProps = {
  searchParams: TodaySearchParams;
};

const RECENT_RUN_DAY_COUNT = 7;

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

async function getLatestSuccessfulRunOverall() {
  return prisma.importRun.findFirst({
    where: { status: ImportRunStatus.SUCCESS },
    orderBy: [{ runDate: "desc" }, { createdAt: "desc" }],
  });
}

function getUtcRecentRunBounds(latestRunDate: Date) {
  const start = new Date(
    Date.UTC(
      latestRunDate.getUTCFullYear(),
      latestRunDate.getUTCMonth(),
      latestRunDate.getUTCDate() - (RECENT_RUN_DAY_COUNT - 1),
    ),
  );
  const end = new Date(
    Date.UTC(
      latestRunDate.getUTCFullYear(),
      latestRunDate.getUTCMonth(),
      latestRunDate.getUTCDate() + 1,
    ),
  );

  return { start, end };
}

function getRunDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getTodayTitle(selectedRun: { runDate: Date } | null) {
  if (!selectedRun) {
    return "Today";
  }

  return getRunDateKey(selectedRun.runDate) === getLocalDateKey(new Date())
    ? "Today"
    : formatDateOnly(selectedRun.runDate);
}

async function getRecentSuccessfulRuns(latestRunDate: Date) {
  const { start, end } = getUtcRecentRunBounds(latestRunDate);

  const runs = await prisma.importRun.findMany({
    where: {
      status: ImportRunStatus.SUCCESS,
      runDate: {
        gte: start,
        lt: end,
      },
    },
    orderBy: [{ runDate: "desc" }, { createdAt: "desc" }],
  });
  const seenDates = new Set<string>();

  return runs.filter((run) => {
    const key = getRunDateKey(run.runDate);

    if (seenDates.has(key)) {
      return false;
    }

    seenDates.add(key);
    return true;
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

async function getRecommendationsForRun(runId: string, runDate: Date) {
  return prisma.jobRecommendation.findMany({
    where: { importRunId: runId },
    include: {
      job: {
        include: {
          tracking: true,
          recommendations: {
            where: {
              importRun: {
                status: ImportRunStatus.SUCCESS,
                runDate: { lt: runDate },
              },
            },
            select: { importRun: { select: { runDate: true } } },
          },
        },
      },
    },
    orderBy: [{ fitScore: "desc" }, { createdAt: "asc" }],
  });
}

async function getListingHistory(runDate: Date) {
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      sourceUrl: true,
      tracking: { select: { status: true, appliedAt: true } },
      recommendations: {
        where: {
          importRun: { status: ImportRunStatus.SUCCESS, runDate: { lt: runDate } },
        },
        select: { importRun: { select: { runDate: true } } },
      },
    },
  });
  return jobs.map((job) => ({ ...job, source_url: job.sourceUrl }));
}

type RecommendationWithJob = Awaited<
  ReturnType<typeof getRecommendationsForRun>
>[number];

function toTodayItem(
  recommendation: RecommendationWithJob,
  listingHistory: Awaited<ReturnType<typeof getListingHistory>>,
): TodayJobItem {
  const job = recommendation.job;
  const status = job.tracking?.status ?? JobStatus.NEW;
  const aliases = findMatchingHistory({ ...job, source_url: job.sourceUrl }, listingHistory)
    .matches.filter((match) => match.id !== job.id);
  const previousRunDates = Array.from(new Set(
    [job, ...aliases].flatMap((match) => match.recommendations.map((previous) => previous.importRun.runDate.toISOString())),
  ));
  const descriptionSections = parseJobDescriptionSections(job.description);
  const raw = recommendation.rawRecommendation;
  const repeatReason = raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.repeat_reason === "string"
    ? raw.repeat_reason.trim() || null
    : null;
  const rawEvidenceUrl = raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.repeat_evidence_url === "string"
    ? raw.repeat_evidence_url
    : null;
  let repeatEvidenceUrl: string | null = null;
  try {
    const url = rawEvidenceUrl ? new URL(rawEvidenceUrl) : null;
    if (url?.protocol === "https:") repeatEvidenceUrl = url.href;
  } catch {
    // Older raw recommendations may predate evidence validation.
  }

  return {
    recommendationId: recommendation.id,
    jobId: job.id,
    title: job.title,
    company: job.company,
    companyWebsiteUrl: getCompanyWebsiteUrl(
      recommendation.rawRecommendation,
    ),
    location: job.location,
    remoteType: job.remoteType,
    salary: formatSalary(job.salaryMin, job.salaryMax),
    salarySort: getSalarySortValue(job.salaryMin, job.salaryMax),
    sourceUrl: job.sourceUrl,
    status,
    appliedAt: job.tracking?.appliedAt?.toISOString() ?? null,
    previousRunDates,
    blockedByRelatedTracking: aliases.some((match) => !isRecommendationTrackingEligible(
      match.tracking?.status ?? JobStatus.NEW,
      match.tracking?.appliedAt ?? null,
    )),
    repeatReason,
    repeatEvidenceUrl,
    isRepeat: previousRunDates.length > 0,
    recommendationSuppressed: false,
    fitScore: recommendation.fitScore,
    fitTier: getFitTier(recommendation.fitScore),
    priority: recommendation.priority,
    priorityClass: priorityBadgeClass(recommendation.priority),
    suggestedAction: recommendation.suggestedAction,
    datePosted: job.datePosted ? formatDateOnly(job.datePosted) : null,
    postedAge: formatPostedAge(job.datePosted, REVIEW_TIME_ZONE),
    companyOverview: descriptionSections.company,
    benefitsOverview: descriptionSections.benefits,
    roleOverview: descriptionSections.role ?? descriptionSections.legacy,
    matchReason: recommendation.matchReason,
    concerns: recommendation.concerns,
    matchedSkills: recommendation.matchedSkills,
    missingSkills: recommendation.missingSkills,
    resumePath: job.tracking?.resumePath ?? "",
    resumeVersion: job.tracking?.resumeVersion ?? "",
  };
}

function sortInitialItems(items: TodayJobItem[], highFitThreshold: number) {
  return [...items].sort((left, right) => {
    if (left.recommendationSuppressed !== right.recommendationSuppressed) {
      return left.recommendationSuppressed ? 1 : -1;
    }
    if (left.isRepeat !== right.isRepeat) {
      return left.isRepeat ? 1 : -1;
    }
    const leftApply = isApplyTodayJob({
      fitScore: left.fitScore,
      concerns: left.concerns,
      status: left.status,
      appliedAt: left.appliedAt,
      suggestedAction: left.suggestedAction,
      highFitThreshold,
    });
    const rightApply = isApplyTodayJob({
      fitScore: right.fitScore,
      concerns: right.concerns,
      status: right.status,
      appliedAt: right.appliedAt,
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
      !item.recommendationSuppressed &&
      isApplyTodayJob({
        fitScore: item.fitScore,
        concerns: item.concerns,
        status: item.status,
        appliedAt: item.appliedAt,
        suggestedAction: item.suggestedAction,
        highFitThreshold,
      }),
  ).length;
}

function buildRunOptions(input: {
  selectedRun: { id: string; runDate: Date } | null;
  recentRuns: Awaited<ReturnType<typeof getRecentSuccessfulRuns>>;
}) {
  const options: RunDateOption[] = input.recentRuns.map((run) => ({
    id: run.id,
    label: formatDateOnly(run.runDate),
  }));

  if (
    input.selectedRun &&
    !options.some((option) => option.id === input.selectedRun?.id)
  ) {
    options.unshift({
      id: input.selectedRun.id,
      label: formatDateOnly(input.selectedRun.runDate),
    });
  }

  return options;
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
  const [
    latestRunOverall,
    latestSuccessfulRun,
    requestedRun,
    highFitThreshold,
  ] = await Promise.all([
    getLatestRunOverall(),
    getLatestSuccessfulRunOverall(),
    getRequestedSuccessfulRun(requestedRunId),
    getHighFitThreshold(),
  ]);
  const selectedRun = requestedRun ?? latestSuccessfulRun;
  const historicalReview = Boolean(
    selectedRun && latestSuccessfulRun &&
    getRunDateKey(selectedRun.runDate) < getRunDateKey(latestSuccessfulRun.runDate),
  );
  const recentRuns = latestSuccessfulRun
    ? await getRecentSuccessfulRuns(latestSuccessfulRun.runDate)
    : [];
  const nextSuccessfulRun =
    !requestedRun && latestRunOverall?.status === ImportRunStatus.FAILED
      ? await getNextSuccessfulRunBefore(
          latestRunOverall.createdAt,
          latestRunOverall.runDate,
        )
      : null;
  const [recommendations, listingHistory] = selectedRun
    ? await Promise.all([
        getRecommendationsForRun(selectedRun.id, selectedRun.runDate),
        getListingHistory(selectedRun.runDate),
      ])
    : [[], []];
  const candidates = recommendations.map((recommendation) => toTodayItem(recommendation, listingHistory));
  const selection = selectedRun && !historicalReview
    ? selectRecommendations(candidates.filter((item) => !item.blockedByRelatedTracking), selectedRun.runDate)
    : { eligible: candidates, suppressed: [] };
  const items = sortInitialItems(
    [
      ...selection.eligible,
      ...selection.suppressed.map((item) => ({ ...item, recommendationSuppressed: true })),
      ...candidates.filter((item) => !historicalReview && item.blockedByRelatedTracking).map((item) => ({ ...item, recommendationSuppressed: true })),
    ],
    highFitThreshold,
  );
  const totalRecommendations = items.length;
  const applyTodayCount = historicalReview ? 0 : getApplyTodayCount(items, highFitThreshold);
  const runOptions = buildRunOptions({
    recentRuns,
    selectedRun,
  });
  const subline = selectedRun
    ? `${formatDateOnly(selectedRun.runDate)} · ${applyTodayCount} to apply today`
    : "Latest recommendations will appear here after an import.";
  const pageTitle = getTodayTitle(selectedRun);

  return (
    <main className="paper-app">
      <div className="paper-wrap">
        <header className="paper-head">
          <div>
            <p className="paper-eyebrow">Daily Review</p>
            <h1 className="paper-title">{pageTitle}</h1>
            {selectedRun ? (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <RunDateSelect
                    includeHidden={includeHidden}
                    options={runOptions}
                    selectedRunId={selectedRun.id}
                  />
                  {!historicalReview ? (
                    <span className="paper-sub !mt-0">
                      · <strong>{applyTodayCount} to apply today</strong>
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="paper-sub">{subline}</p>
            )}
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
          <EmptyState title={historicalReview ? "No jobs were imported for this date" : "No new recommendations qualify"}>
            <p>Your existing applications and saved jobs are still available on the Board.</p>
            <p>Run timestamp: {formatTimestamp(selectedRun.createdAt)}</p>
            <Link className="paper-btn mt-4" href="/board">Open Board</Link>
          </EmptyState>
        ) : null}

        {selectedRun && items.length > 0 ? (
          <TodayClient
            highFitThreshold={highFitThreshold}
            initialShowHidden={includeHidden}
            jobs={items}
            key={selectedRun.id}
            runDate={selectedRun.runDate.toISOString()}
            historicalReview={historicalReview}
          />
        ) : null}
      </div>
    </main>
  );
}
