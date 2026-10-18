"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronDown, Search } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { formatStatusLabel } from "@/lib/format";
import { getJobDetailHref } from "@/lib/jobs/links";
import { isApplyTodayJob } from "@/lib/jobs/prioritization";
import {
  isRecommendationTrackingEligible,
  selectRecommendations,
} from "@/lib/jobs/recommendation-eligibility";
import { canTailorResumeForStatus } from "@/lib/jobs/resume-tailoring";
import { patchJobTracking } from "@/lib/jobs/tracking-client";

const defaultVisibleJobs = 12;

const quickActions = [
  { status: "INTERESTED", label: "Interested" },
  { status: "APPLYING", label: "Applying" },
  { status: "APPLIED", label: "Applied" },
  { status: "PASSED", label: "Passed" },
  { status: "ARCHIVED", label: "Archived" },
] as const;

type FilterMode = "all" | "apply" | "high" | "tracking";
type SortMode = "fit" | "salary" | "company";

export type TodayJobItem = {
  recommendationId: string;
  jobId: string;
  title: string;
  company: string;
  companyWebsiteUrl: string | null;
  location: string | null;
  remoteType: string | null;
  salary: string | null;
  salarySort: number;
  sourceUrl: string | null;
  status: string;
  appliedAt: string | null;
  previousRunDates: string[];
  repeatReason: string | null;
  repeatEvidenceUrl: string | null;
  isRepeat: boolean;
  recommendationSuppressed: boolean;
  blockedByRelatedTracking: boolean;
  statusHue: string;
  fitScore: number | null;
  fitTier: string;
  priority: string | null;
  priorityClass: string;
  suggestedAction: string | null;
  datePosted: string;
  companyOverview: string | null;
  benefitsOverview: string | null;
  roleOverview: string | null;
  matchReason: string | null;
  concerns: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  resumePath: string;
  resumeVersion: string;
};

type TailoredResumeFields = {
  resumePath: string;
  resumeVersion: string;
};

type TailorResumeSuccess = TailoredResumeFields & {
  ok: true;
  warnings?: string[];
  changes?: string[];
};

type TailorResumeFailure = {
  ok: false;
  errorMessage?: string;
};

type TailorResumeResponse = TailorResumeSuccess | TailorResumeFailure;

export function isApplyTodayClient(job: TodayJobItem, highFitThreshold: number, historicalReview = false) {
  return (
    !historicalReview &&
    !job.recommendationSuppressed &&
    isApplyTodayJob({ ...job, highFitThreshold })
  );
}

function isHighFitClient(job: TodayJobItem, highFitThreshold: number) {
  return typeof job.fitScore === "number" && job.fitScore >= highFitThreshold;
}

// Imported locations often already say "remote" or "hybrid"; avoid repeating it.
function isRemoteTypeInLocation(job: TodayJobItem) {
  return Boolean(
    job.remoteType &&
      job.location?.toLowerCase().includes(job.remoteType.toLowerCase()),
  );
}

function BadgeCluster({
  job,
  highFitThreshold,
  historicalReview,
}: {
  job: TodayJobItem;
  highFitThreshold: number;
  historicalReview: boolean;
}) {
  const applyToday = isApplyTodayClient(job, highFitThreshold, historicalReview);
  const highFit = isHighFitClient(job, highFitThreshold);

  return (
    <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
      {!historicalReview && job.recommendationSuppressed ? (
        <span className="paper-badge badge-neutral">Hidden · history review</span>
      ) : null}
      {job.isRepeat ? (
        <span className="paper-badge badge-neutral">Repeat</span>
      ) : null}
      {applyToday ? (
        <span className="paper-badge badge-apply">Apply Today</span>
      ) : null}
      {highFit ? <span className="paper-badge badge-fit">High Fit</span> : null}
      {job.priority ? (
        <span className={`paper-badge ${job.priorityClass}`}>
          {formatStatusLabel(job.priority)}
        </span>
      ) : null}
    </div>
  );
}

function SkillChips({
  skills,
  missing,
}: {
  skills: string[];
  missing?: boolean;
}) {
  if (skills.length === 0) {
    return <span className="text-sm text-[var(--ink-faint)]">None</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <span
          className={`paper-badge text-[11px] ${
            missing ? "badge-pass" : "badge-neutral"
          }`}
          key={skill}
        >
          {skill}
        </span>
      ))}
    </div>
  );
}

function DetailCopy({
  value,
  fallback,
}: {
  value: string | null;
  fallback: string;
}) {
  const text = value ?? fallback;

  return (
    <p
      className="mt-2 h-[4.5rem] line-clamp-3 text-sm leading-6 text-[var(--ink-soft)]"
      title={text}
    >
      {text}
    </p>
  );
}

function FitStat({ job }: { job: TodayJobItem }) {
  const score = job.fitScore ?? 0;

  return (
    <div className="flex items-center gap-3">
      <div
        className="fit-ring"
        style={{ "--score": score } as CSSProperties}
      >
        <span>{job.fitScore ?? "-"}</span>
      </div>
      <div>
        <p className="paper-label">Fit Score</p>
        <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
          {job.fitTier}
        </p>
      </div>
    </div>
  );
}

function TodayCard({
  job,
  highFitThreshold,
  historicalReview,
  isOpen,
  onToggleOpen,
  onStatusChange,
  onResumeTailored,
}: {
  job: TodayJobItem;
  highFitThreshold: number;
  historicalReview: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  onStatusChange: (job: TodayJobItem, status: string) => void;
  onResumeTailored: (jobId: string, fields: TailoredResumeFields) => void;
}) {
  const applyToday = isApplyTodayClient(job, highFitThreshold, historicalReview);
  const canTailorResume = canTailorResumeForStatus(job.status);
  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [tailorWarnings, setTailorWarnings] = useState<string[]>([]);
  const [tailorChanges, setTailorChanges] = useState<string[]>([]);

  async function tailorResume() {
    if (!canTailorResume || tailoring) {
      return;
    }

    setTailoring(true);
    setTailorError(null);
    setTailorWarnings([]);
    setTailorChanges([]);

    try {
      const response = await fetch(`/api/jobs/${job.jobId}/tailor-resume`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({
        ok: false,
        errorMessage: "Resume tailoring failed.",
      }))) as TailorResumeResponse;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.ok ? "Resume tailoring failed." : data.errorMessage ?? "Resume tailoring failed.",
        );
      }

      onResumeTailored(job.jobId, {
        resumePath: data.resumePath,
        resumeVersion: data.resumeVersion,
      });
      setTailorWarnings(data.warnings ?? []);
      setTailorChanges(data.changes ?? []);
    } catch (error) {
      setTailorError(
        error instanceof Error ? error.message : "Resume tailoring failed.",
      );
    } finally {
      setTailoring(false);
    }
  }

  return (
    <article className="paper-card relative overflow-hidden">
      {applyToday ? (
        <span className="absolute bottom-5 left-0 top-5 w-[3px] rounded-full bg-[var(--accent)]" />
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[19px] font-bold leading-tight text-[var(--ink)]">
              <Link
                className="paper-link"
                href={getJobDetailHref(job.jobId)}
                rel="noreferrer"
                target="_blank"
              >
                {job.title}
              </Link>
            </h2>
            {job.status !== "NEW" ? (
              <span className="paper-badge badge-neutral">
                <span
                  className="status-dot"
                  style={{ "--status-hue": job.statusHue } as CSSProperties}
                />
                {formatStatusLabel(job.status)}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-[14px] text-[var(--ink-soft)]">
            {job.companyWebsiteUrl ? (
              <a
                aria-label={`${job.company} official website (opens in a new tab)`}
                className="paper-link font-semibold text-[var(--ink)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                href={job.companyWebsiteUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {job.company}
              </a>
            ) : (
              <strong className="font-semibold text-[var(--ink)]">
                {job.company}
              </strong>
            )}
            {job.location ? (
              <span className="text-[var(--ink-faint)]"> · {job.location}</span>
            ) : null}
            {job.remoteType && !isRemoteTypeInLocation(job) ? (
              <span className="text-[var(--ink-faint)]">
                {" "}
                · {job.remoteType}
              </span>
            ) : null}
          </p>
          {job.salary ? (
            <p className="mt-2 font-mono text-[13px] text-[var(--ink-soft)]">
              {job.salary}
            </p>
          ) : null}
        </div>
        <BadgeCluster highFitThreshold={highFitThreshold} historicalReview={historicalReview} job={job} />
      </div>

      {job.isRepeat && job.repeatReason ? (
        <div className="mt-4 rounded-[var(--radius-ctl)] border border-[var(--hair)] bg-[var(--surface-2)] p-4">
          <p className="paper-label">{historicalReview || job.recommendationSuppressed ? "Repeat context" : "Why this is worth another look"}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{job.repeatReason}</p>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-x-12 gap-y-4 border-t border-[var(--hair)] pt-5">
        <FitStat job={job} />
        <div>
          <p className="paper-label">Date Posted</p>
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">
            {job.datePosted}
          </p>
        </div>
      </div>

      <div
        aria-hidden={!isOpen}
        className={`grid transition-all duration-300 ${
          isOpen
            ? "mt-5 grid-rows-[1fr] opacity-100"
            : "pointer-events-none grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
        {job.roleOverview ? (
          <div className="mb-5 rounded-[var(--radius-ctl)] border border-[var(--hair)] bg-[var(--surface-2)] p-4">
            <p className="paper-label">Role overview</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink)]">
              {job.roleOverview}
            </p>
          </div>
        ) : null}

        <div className="grid gap-5 border-t border-[var(--hair)] pt-5 md:grid-cols-2">
          <div>
            <p className="paper-label">Company</p>
            <DetailCopy
              fallback="No company overview provided."
              value={job.companyOverview}
            />
          </div>
          <div>
            <p className="paper-label">Benefits</p>
            <DetailCopy
              fallback="No benefits information provided."
              value={job.benefitsOverview}
            />
          </div>
          <div>
            <p className="paper-label">Match Reason</p>
            <DetailCopy
              fallback="No match reason provided."
              value={job.matchReason}
            />
            <div className="mt-3">
              <SkillChips skills={job.matchedSkills} />
            </div>
          </div>
          <div>
            <p className="paper-label">Concerns</p>
            <DetailCopy
              fallback="No major concerns."
              value={job.concerns}
            />
            <div className="mt-3">
              <SkillChips missing skills={job.missingSkills} />
            </div>
          </div>
        </div>

        {canTailorResume ? (
          <div className="mt-5 rounded-[var(--radius-ctl)] border border-[var(--hair)] bg-[var(--surface-2)] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="paper-label text-[var(--accent-ink)]">
                  Resume tailoring
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                  Generate a Markdown resume from this job&apos;s recommendation context.
                </p>
              </div>
              <button
                className="paper-btn paper-btn-solid h-9 px-3 text-xs"
                disabled={tailoring}
                onClick={() => void tailorResume()}
                type="button"
              >
                <span aria-hidden="true">✦</span>
                {tailoring ? "Generating" : "Tailor resume"}
              </button>
            </div>

            {tailoring ? (
              <p className="mt-2 text-xs text-[var(--ink-soft)]">
                Gemini is tailoring a Markdown resume. This may take a moment.
              </p>
            ) : null}

            {tailorError ? (
              <div className="mt-3 flex gap-2 rounded-[10px] border border-[var(--pass-border)] bg-[var(--pass-bg)] p-3 text-xs leading-5 text-[var(--pass-ink)]">
                <span aria-hidden="true" className="mt-0.5 flex-none">⚠</span>
                <span>{tailorError}</span>
              </div>
            ) : null}

            {job.resumePath && !tailorError ? (
              <div className="mt-3 rounded-[10px] border border-[var(--accent-border)] bg-[var(--accent-bg)] p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--accent-ink)]">
                  <span aria-hidden="true">✓</span>
                  Resume saved
                </p>
                <p className="mt-1 break-all font-mono text-[10.5px] leading-5 text-[var(--accent-ink)]">
                  {job.resumeVersion || "Tailored resume"}
                </p>
                <p className="mt-1 break-all font-mono text-[10.5px] leading-5 text-[var(--ink-soft)]">
                  {job.resumePath}
                </p>
              </div>
            ) : null}

            {tailorWarnings.length > 0 ? (
              <div className="mt-3 rounded-[10px] border border-[var(--high-border)] bg-[var(--high-bg)] p-3">
                <p className="paper-label text-[var(--high-ink)]">Review notes</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-[#7a4e12]">
                  {tailorWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {tailorChanges.length > 0 ? (
              <div className="mt-3 rounded-[10px] border border-[var(--hair)] bg-[var(--surface)] p-3">
                <p className="paper-label">Changes</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-[var(--ink-soft)]">
                  {tailorChanges.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4 border-t border-[var(--hair)] pt-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="paper-row">
          {quickActions.map((action) => {
            const isCurrent = job.status === action.status;
            const isHiddenAction =
              action.status === "PASSED" || action.status === "ARCHIVED";

            return (
              <button
                className={`paper-btn h-8 px-3 text-xs ${
                  isCurrent
                    ? isHiddenAction
                      ? "badge-pass"
                      : "bg-[var(--ink)] text-white"
                    : ""
                }`}
                disabled={isCurrent}
                key={action.status}
                onClick={() => onStatusChange(job, action.status)}
                type="button"
              >
                {action.label}
              </button>
            );
          })}
        </div>

        <div className="paper-row">
          <button
            className="paper-btn"
            onClick={onToggleOpen}
            type="button"
          >
            Details
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {job.sourceUrl ? (
            <a
              className="paper-btn paper-btn-solid"
              href={job.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              {historicalReview || job.recommendationSuppressed ? "View source" : "Apply"}
              <ArrowRight className="h-4 w-4" />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function TodayClient({
  jobs,
  highFitThreshold,
  initialShowHidden,
  runDate,
  historicalReview,
}: {
  jobs: TodayJobItem[];
  highFitThreshold: number;
  initialShowHidden: boolean;
  runDate: string;
  historicalReview: boolean;
}) {
  const [items, setItems] = useState(jobs);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("fit");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(initialShowHidden);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [toast, setToast] = useState<
    | {
        kind: "undo";
        message: string;
        job: TodayJobItem;
        previousStatus: string;
        previousAppliedAt: string | null;
      }
    | { kind: "error"; message: string }
    | null
  >(null);

  const recommendationItems = useMemo(() => {
    if (historicalReview) {
      return items.map((job) => ({ ...job, recommendationSuppressed: false }));
    }
    const selection = selectRecommendations(items.filter((job) => !job.blockedByRelatedTracking), new Date(runDate));
    return [
      ...selection.eligible.map((job) => ({ ...job, recommendationSuppressed: false })),
      ...selection.suppressed.map((job) => ({ ...job, recommendationSuppressed: true })),
      ...items.filter((job) => job.blockedByRelatedTracking).map((job) => ({ ...job, recommendationSuppressed: true })),
    ];
  }, [historicalReview, items, runDate]);
  const suppressedCount = recommendationItems.filter((job) => job.recommendationSuppressed).length;
  const hasEligibleRecommendations = recommendationItems.some((job) => !job.recommendationSuppressed);

  const filteredJobs = useMemo(() => {
    const queryValue = query.trim().toLowerCase();

    return recommendationItems
      .filter((job) => showHidden || !job.recommendationSuppressed)
      .filter((job) => {
        if (!queryValue) {
          return true;
        }

        return [
          job.title,
          job.company,
          job.location,
          job.remoteType,
          job.companyOverview,
          job.benefitsOverview,
          job.roleOverview,
          ...job.matchedSkills,
          ...job.missingSkills,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(queryValue);
      })
      .filter((job) => {
        if (filter === "apply") {
          return isApplyTodayClient(job, highFitThreshold, historicalReview);
        }

        if (filter === "high") {
          return isHighFitClient(job, highFitThreshold);
        }

        if (filter === "tracking") {
          return job.status !== "NEW";
        }

        return true;
      })
      .sort((left, right) => {
        if (left.recommendationSuppressed !== right.recommendationSuppressed) {
          return left.recommendationSuppressed ? 1 : -1;
        }
        if (!historicalReview && left.isRepeat !== right.isRepeat) {
          return left.isRepeat ? 1 : -1;
        }
        if (sort === "company") {
          return left.company.localeCompare(right.company);
        }

        if (sort === "salary") {
          return right.salarySort - left.salarySort;
        }

        const leftApply = isApplyTodayClient(left, highFitThreshold, historicalReview);
        const rightApply = isApplyTodayClient(right, highFitThreshold, historicalReview);

        if (leftApply !== rightApply) {
          return leftApply ? -1 : 1;
        }

        return (right.fitScore ?? -1) - (left.fitScore ?? -1);
      });
  }, [filter, highFitThreshold, historicalReview, recommendationItems, query, showHidden, sort]);
  const visibleJobs = showAllJobs
    ? filteredJobs
    : filteredJobs.slice(0, defaultVisibleJobs);
  const hiddenJobCount = filteredJobs.length - visibleJobs.length;

  async function updateStatus(job: TodayJobItem, status: string, restoredAppliedAt?: string | null) {
    const previousStatus = job.status;
    const appliedAt = restoredAppliedAt !== undefined
      ? restoredAppliedAt
      : job.appliedAt ?? (status === "APPLIED" ? new Date().toISOString() : null);
    setToast((current) => (current?.kind === "error" ? null : current));
    setItems((current) =>
      current.map((item) =>
        item.jobId === job.jobId ? { ...item, status, appliedAt } : item,
      ),
    );

    try {
      const tracking = await patchJobTracking(job.jobId, {
        status,
        ...(restoredAppliedAt !== undefined ? { appliedAt: restoredAppliedAt } : {}),
      });
      setItems((current) => current.map((item) =>
        item.jobId === job.jobId
          ? { ...item, status: tracking.status, appliedAt: tracking.appliedAt }
          : item,
      ));

      if (!historicalReview && !isRecommendationTrackingEligible(status, tracking.appliedAt) && !showHidden) {
        setToast({
          kind: "undo",
          message: `${job.company} moved to ${formatStatusLabel(status)}.`,
          job: { ...job, status, appliedAt: tracking.appliedAt },
          previousStatus,
          previousAppliedAt: job.appliedAt,
        });
      }
    } catch (error) {
      setItems((current) =>
        current.map((item) =>
          item.jobId === job.jobId
            ? { ...item, status: previousStatus, appliedAt: job.appliedAt }
            : item,
        ),
      );
      setToast({
        kind: "error",
        message: `Couldn't update ${job.company}. ${error instanceof Error ? error.message : "Unknown error."}`,
      });
    }
  }

  async function undoStatus() {
    if (toast?.kind !== "undo") {
      return;
    }

    const { job, previousStatus, previousAppliedAt } = toast;
    setToast(null);
    await updateStatus(job, previousStatus, previousAppliedAt);
  }

  function updateResumeFields(jobId: string, fields: TailoredResumeFields) {
    setItems((current) =>
      current.map((item) =>
        item.jobId === jobId ? { ...item, ...fields } : item,
      ),
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="paper-seg">
          {[
            ["all", "All"],
            ["apply", "Apply Today"],
            ["high", "High Fit"],
            ["tracking", "Tracking"],
          ].filter(([value]) => !historicalReview || value !== "apply").map(([value, label]) => (
            <button
              data-on={filter === value}
              key={value}
              onClick={() => setFilter(value as FilterMode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <label className="paper-field flex-[0_1_260px]">
          <Search />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search roles"
            value={query}
          />
        </label>

        <div className="flex flex-1" />

        <span className="paper-label">Sort</span>
        <div className="paper-seg">
          {[
            ["fit", "Fit score"],
            ["salary", "Salary"],
            ["company", "Company"],
          ].map(([value, label]) => (
            <button
              data-on={sort === value}
              key={value}
              onClick={() => setSort(value as SortMode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!historicalReview && (suppressedCount > 0 || showHidden) ? <div className="mb-5">
        <button
          className="paper-btn paper-btn-ghost"
          aria-pressed={showHidden}
          onClick={() => setShowHidden((value) => !value)}
          type="button"
        >
          {showHidden ? "Hide excluded recommendations" : `Show hidden (${suppressedCount})`}
        </button>
        {showHidden ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            History review includes applications, closed jobs, and repeats that did not qualify for today&apos;s recommendations.
          </p>
        ) : null}
      </div> : null}

      {filteredJobs.length === 0 ? (
        <div className="paper-card paper-empty">
          <h2 className="text-lg font-bold text-[var(--ink)]">
            {!showHidden && !hasEligibleRecommendations ? "No new recommendations qualify" : "No roles match"}
          </h2>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            {!showHidden && !hasEligibleRecommendations
              ? "Your existing applications and saved jobs are still on the Board. Repeated roles can return when their strong fit is supported by current evidence."
              : "Adjust the filter, search, or Show hidden toggle."}
          </p>
          {!showHidden && !hasEligibleRecommendations ? (
            <Link className="paper-btn mt-4" href="/board">Open Board</Link>
          ) : null}
        </div>
      ) : (
        <section className="flex flex-col gap-[18px]">
          {visibleJobs.map((job) => (
            <TodayCard
              highFitThreshold={highFitThreshold}
              historicalReview={historicalReview}
              isOpen={openIds.has(job.jobId)}
              job={job}
              key={job.recommendationId}
              onResumeTailored={updateResumeFields}
              onStatusChange={updateStatus}
              onToggleOpen={() =>
                setOpenIds((current) => {
                  const next = new Set(current);

                  if (next.has(job.jobId)) {
                    next.delete(job.jobId);
                  } else {
                    next.add(job.jobId);
                  }

                  return next;
                })
              }
            />
          ))}
        </section>
      )}

      {filteredJobs.length > defaultVisibleJobs ? (
        <div className="mt-5 flex justify-center">
          <button
            className="paper-btn"
            onClick={() => setShowAllJobs((value) => !value)}
            type="button"
          >
            {showAllJobs
              ? `Show top ${defaultVisibleJobs} only`
              : `Show remaining ${hiddenJobCount} from this day`}
          </button>
        </div>
      ) : null}

      {toast ? (
        <div
          className="fixed bottom-5 left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-white shadow-xl"
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {toast.kind === "error" ? (
            <AlertTriangle aria-hidden="true" className="h-4 w-4 flex-none text-[var(--pass-border)]" />
          ) : null}
          <span>{toast.message}</span>
          {toast.kind === "error" ? (
            <button
              className="font-bold text-[var(--pass-border)]"
              onClick={() => setToast(null)}
              type="button"
            >
              Dismiss
            </button>
          ) : (
            <button
              className="font-bold text-[var(--accent-border)]"
              onClick={undoStatus}
              type="button"
            >
              Undo
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}
