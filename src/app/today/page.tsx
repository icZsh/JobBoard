import Link from "next/link";
import { ImportRunStatus, JobStatus, type Priority } from "@/generated/prisma/client";
import { formatDateOnly, formatSalary, formatStatusLabel, formatTimestamp } from "@/lib/format";
import { isApplyTodayJob, isHighFit } from "@/lib/jobs/prioritization";
import { prisma } from "@/lib/prisma";
import { getHighFitThreshold } from "@/lib/settings";
import { updateTodayJobStatus } from "./actions";

export const dynamic = "force-dynamic";

type TodaySearchParams = Promise<{
  includeHidden?: string | string[];
  runId?: string | string[];
}>;

type TodayPageProps = {
  searchParams: TodaySearchParams;
};

type RecommendationWithJob = Awaited<
  ReturnType<typeof getRecommendationsForRun>
>[number];

const hiddenStatuses = [JobStatus.PASSED, JobStatus.ARCHIVED];

const quickActions = [
  { status: JobStatus.INTERESTED, label: "Interested" },
  { status: JobStatus.APPLYING, label: "Applying" },
  { status: JobStatus.APPLIED, label: "Applied" },
  { status: JobStatus.PASSED, label: "Passed" },
  { status: JobStatus.ARCHIVED, label: "Archived" },
];

const priorityStyles: Record<Priority, string> = {
  LOW: "border-slate-200 bg-slate-50 text-slate-600",
  MEDIUM: "border-sky-200 bg-sky-50 text-sky-700",
  HIGH: "border-amber-200 bg-amber-50 text-amber-800",
  URGENT: "border-rose-200 bg-rose-50 text-rose-700",
};

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

async function getRecommendationsForRun(runId: string, includeHidden: boolean) {
  return prisma.jobRecommendation.findMany({
    where: {
      importRunId: runId,
      job: includeHidden
        ? undefined
        : {
            tracking: {
              status: { notIn: hiddenStatuses },
            },
          },
    },
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

function sortRecommendations(
  recommendations: RecommendationWithJob[],
  highFitThreshold: number,
) {
  return [...recommendations].sort((left, right) => {
    const leftStatus = left.job.tracking?.status;
    const rightStatus = right.job.tracking?.status;
    const leftApplyToday = isApplyTodayJob({
      fitScore: left.fitScore,
      concerns: left.concerns,
      status: leftStatus,
      suggestedAction: left.suggestedAction,
      highFitThreshold,
    });
    const rightApplyToday = isApplyTodayJob({
      fitScore: right.fitScore,
      concerns: right.concerns,
      status: rightStatus,
      suggestedAction: right.suggestedAction,
      highFitThreshold,
    });

    if (leftApplyToday !== rightApplyToday) {
      return leftApplyToday ? -1 : 1;
    }

    return (right.fitScore ?? -1) - (left.fitScore ?? -1);
  });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
      {formatStatusLabel(status)}
    </span>
  );
}

function RecommendationBadges({
  recommendation,
  highFitThreshold,
}: {
  recommendation: RecommendationWithJob;
  highFitThreshold: number;
}) {
  const status = recommendation.job.tracking?.status ?? JobStatus.NEW;
  const highFit = isHighFit(recommendation.fitScore, highFitThreshold);
  const applyToday = isApplyTodayJob({
    fitScore: recommendation.fitScore,
    concerns: recommendation.concerns,
    status,
    suggestedAction: recommendation.suggestedAction,
    highFitThreshold,
  });

  return (
    <div className="flex flex-wrap gap-2">
      {applyToday ? (
        <span className="inline-flex items-center border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
          Apply Today
        </span>
      ) : null}
      {highFit ? (
        <span className="inline-flex items-center border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700">
          High Fit
        </span>
      ) : null}
      {recommendation.priority ? (
        <span
          className={`inline-flex items-center border px-2 py-1 text-xs font-medium ${priorityStyles[recommendation.priority]}`}
        >
          {recommendation.priority}
        </span>
      ) : null}
    </div>
  );
}

function QuickActions({
  jobId,
  currentStatus,
  redirectTo,
}: {
  jobId: string;
  currentStatus: string;
  redirectTo: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {quickActions.map((action) => {
        const isCurrent = action.status === currentStatus;

        return (
          <form key={action.status} action={updateTodayJobStatus}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="status" value={action.status} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <button
              className={`h-8 border px-2.5 text-xs font-medium transition ${
                isCurrent
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
              }`}
              disabled={isCurrent}
              type="submit"
            >
              {action.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}

function JobCard({
  recommendation,
  highFitThreshold,
  redirectTo,
}: {
  recommendation: RecommendationWithJob;
  highFitThreshold: number;
  redirectTo: string;
}) {
  const job = recommendation.job;
  const tracking = job.tracking;
  const status = tracking?.status ?? JobStatus.NEW;
  const salary = formatSalary(job.salaryMin, job.salaryMax);

  return (
    <article className="border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-950">
              {job.title}
            </h2>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
            {job.remoteType ? ` · ${job.remoteType}` : ""}
          </p>
          {salary ? <p className="mt-1 text-sm text-slate-600">{salary}</p> : null}
        </div>

        <RecommendationBadges
          highFitThreshold={highFitThreshold}
          recommendation={recommendation}
        />
      </div>

      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">
            Fit Score
          </dt>
          <dd className="mt-1 text-slate-900">
            {recommendation.fitScore ?? "Not scored"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">
            Suggested Action
          </dt>
          <dd className="mt-1 text-slate-900">
            {recommendation.suggestedAction ?? "None"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-slate-500">
            Date Posted
          </dt>
          <dd className="mt-1 text-slate-900">
            {job.datePosted ? formatDateOnly(job.datePosted) : "Unknown"}
          </dd>
        </div>
      </dl>

      {recommendation.matchReason || recommendation.concerns ? (
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm md:grid-cols-2">
          {recommendation.matchReason ? (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                Match Reason
              </p>
              <p className="mt-1 text-slate-700">{recommendation.matchReason}</p>
            </div>
          ) : null}
          {recommendation.concerns ? (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                Concerns
              </p>
              <p className="mt-1 text-slate-700">{recommendation.concerns}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 lg:flex-row lg:items-center lg:justify-between">
        <QuickActions
          currentStatus={status}
          jobId={job.id}
          redirectTo={redirectTo}
        />
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            className="border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-slate-400"
            href={`/jobs/${job.id}`}
          >
            Details
          </Link>
          {job.sourceUrl ? (
            <a
              className="border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-slate-400"
              href={job.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              Apply
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function EmptyState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <div className="mt-2 text-sm leading-6 text-slate-600">{children}</div>
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
  const totalRecommendations = selectedRun
    ? await prisma.jobRecommendation.count({
        where: { importRunId: selectedRun.id },
      })
    : 0;
  const recommendations = selectedRun
    ? await getRecommendationsForRun(selectedRun.id, includeHidden)
    : [];
  const sortedRecommendations = sortRecommendations(
    recommendations,
    highFitThreshold,
  );
  const currentHref = buildTodayHref({
    includeHidden,
    runId: requestedRun?.id,
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              Daily Review
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Today
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {selectedRun
                ? `${formatDateOnly(selectedRun.runDate)} · ${selectedRun.sourceName ?? "Unknown source"} · imported ${formatTimestamp(selectedRun.createdAt)}`
                : "Latest recommendations will appear here after an import."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {selectedRun ? (
              <Link
                className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
                href={buildTodayHref({
                  includeHidden: !includeHidden,
                  runId: requestedRun?.id,
                })}
              >
                {includeHidden ? "Hide Passed/Archived" : "Show Passed/Archived"}
              </Link>
            ) : null}
            <Link
              className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              href="/import"
            >
              Import
            </Link>
            <Link
              className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              href="/board"
            >
              Board
            </Link>
            <Link
              className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              href="/settings"
            >
              Settings
            </Link>
          </div>
        </header>

        {latestRunOverall?.status === ImportRunStatus.FAILED && !requestedRun ? (
          <EmptyState title="Latest import failed">
            <p>{latestRunOverall.errorMessage ?? "No error message was saved."}</p>
            {nextSuccessfulRun ? (
              <Link
                className="mt-3 inline-flex border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:border-slate-400"
                href={buildTodayHref({ runId: nextSuccessfulRun.id })}
              >
                Open Previous Successful Run
              </Link>
            ) : null}
          </EmptyState>
        ) : null}

        {!latestRunOverall ? (
          <EmptyState title="No imports yet">
            <p>
              Import a daily recommendation payload to start reviewing jobs.
            </p>
            <Link
              className="mt-3 inline-flex border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:border-slate-400"
              href="/import"
            >
              Import Jobs
            </Link>
          </EmptyState>
        ) : null}

        {selectedRun && totalRecommendations === 0 ? (
          <EmptyState title="Latest run completed with no jobs">
            <p>Run timestamp: {formatTimestamp(selectedRun.createdAt)}</p>
          </EmptyState>
        ) : null}

        {selectedRun &&
        totalRecommendations > 0 &&
        sortedRecommendations.length === 0 ? (
          <EmptyState title="All jobs in this run are hidden">
            <Link
              className="inline-flex border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:border-slate-400"
              href={buildTodayHref({
                includeHidden: true,
                runId: requestedRun?.id,
              })}
            >
              Show Passed/Archived
            </Link>
          </EmptyState>
        ) : null}

        {sortedRecommendations.length > 0 ? (
          <section className="grid gap-3">
            {sortedRecommendations.map((recommendation) => (
              <JobCard
                highFitThreshold={highFitThreshold}
                key={recommendation.id}
                recommendation={recommendation}
                redirectTo={currentHref}
              />
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
