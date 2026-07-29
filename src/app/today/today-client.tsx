"use client";

import { ArrowRight, ChevronDown, Search } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { formatStatusLabel } from "@/lib/format";

const quickActions = [
  { status: "INTERESTED", label: "Interested" },
  { status: "APPLYING", label: "Applying" },
  { status: "APPLIED", label: "Applied" },
  { status: "PASSED", label: "Passed" },
  { status: "ARCHIVED", label: "Archived" },
] as const;

const hiddenStatuses = new Set(["PASSED", "ARCHIVED"]);
const terminalApplyStatuses = new Set([
  "APPLIED",
  "REJECTED",
  "PASSED",
  "ARCHIVED",
]);

type FilterMode = "all" | "apply" | "high" | "tracking";
type SortMode = "fit" | "salary" | "company";

export type TodayJobItem = {
  recommendationId: string;
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  remoteType: string | null;
  salary: string | null;
  salarySort: number;
  sourceUrl: string | null;
  status: string;
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
};

export function isApplyTodayClient(job: TodayJobItem, highFitThreshold: number) {
  const suggestedAction = job.suggestedAction ?? "";
  const canStillApply = !terminalApplyStatuses.has(job.status);

  if (/\bapply\s*today\b/iu.test(suggestedAction)) {
    return true;
  }

  if (/\bapply\b/iu.test(suggestedAction) && canStillApply) {
    return true;
  }

  return (
    typeof job.fitScore === "number" &&
    job.fitScore >= highFitThreshold &&
    !job.concerns?.trim() &&
    canStillApply
  );
}

function isHighFitClient(job: TodayJobItem, highFitThreshold: number) {
  return typeof job.fitScore === "number" && job.fitScore >= highFitThreshold;
}

function BadgeCluster({
  job,
  highFitThreshold,
}: {
  job: TodayJobItem;
  highFitThreshold: number;
}) {
  const applyToday = isApplyTodayClient(job, highFitThreshold);
  const highFit = isHighFitClient(job, highFitThreshold);

  return (
    <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
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
  isOpen,
  onToggleOpen,
  onStatusChange,
}: {
  job: TodayJobItem;
  highFitThreshold: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onStatusChange: (job: TodayJobItem, status: string) => void;
}) {
  const applyToday = isApplyTodayClient(job, highFitThreshold);

  return (
    <article className="paper-card relative overflow-hidden">
      {applyToday ? (
        <span className="absolute bottom-5 left-0 top-5 w-[3px] rounded-full bg-[var(--accent)]" />
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[19px] font-bold leading-tight text-[var(--ink)]">
              {job.title}
            </h2>
            {job.status === "NEW" ? (
              <span className="paper-badge badge-neutral">New</span>
            ) : (
              <span className="paper-badge badge-neutral">
                <span
                  className="status-dot"
                  style={{ "--status-hue": job.statusHue } as CSSProperties}
                />
                {formatStatusLabel(job.status)}
              </span>
            )}
          </div>
          <p className="mt-2 text-[14px] text-[var(--ink-soft)]">
            <strong className="font-semibold text-[var(--ink)]">
              {job.company}
            </strong>
            {job.location ? (
              <span className="text-[var(--ink-faint)]"> · {job.location}</span>
            ) : null}
            {job.remoteType ? (
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
        <BadgeCluster highFitThreshold={highFitThreshold} job={job} />
      </div>

      <div className="mt-5 grid gap-4 border-t border-[var(--hair)] pt-5 md:grid-cols-[auto_1fr_1fr]">
        <FitStat job={job} />
        <div>
          <p className="paper-label">Suggested Action</p>
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">
            {job.suggestedAction ?? "None"}
          </p>
        </div>
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
              Apply
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
}: {
  jobs: TodayJobItem[];
  highFitThreshold: number;
  initialShowHidden: boolean;
}) {
  const [items, setItems] = useState(jobs);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("fit");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(initialShowHidden);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{
    message: string;
    job: TodayJobItem;
    previousStatus: string;
  } | null>(null);

  const filteredJobs = useMemo(() => {
    const queryValue = query.trim().toLowerCase();

    return items
      .filter((job) => showHidden || !hiddenStatuses.has(job.status))
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
          return isApplyTodayClient(job, highFitThreshold);
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
        if (sort === "company") {
          return left.company.localeCompare(right.company);
        }

        if (sort === "salary") {
          return right.salarySort - left.salarySort;
        }

        const leftApply = isApplyTodayClient(left, highFitThreshold);
        const rightApply = isApplyTodayClient(right, highFitThreshold);

        if (leftApply !== rightApply) {
          return leftApply ? -1 : 1;
        }

        return (right.fitScore ?? -1) - (left.fitScore ?? -1);
      });
  }, [filter, highFitThreshold, items, query, showHidden, sort]);

  async function updateStatus(job: TodayJobItem, status: string) {
    const previousStatus = job.status;
    setItems((current) =>
      current.map((item) =>
        item.jobId === job.jobId ? { ...item, status } : item,
      ),
    );

    try {
      const response = await fetch(`/api/jobs/${job.jobId}/tracking`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error("Status update failed.");
      }

      if (hiddenStatuses.has(status) && !showHidden) {
        setToast({
          message: `${job.company} moved to ${formatStatusLabel(status)}.`,
          job,
          previousStatus,
        });
      }
    } catch {
      setItems((current) =>
        current.map((item) =>
          item.jobId === job.jobId
            ? { ...item, status: previousStatus }
            : item,
        ),
      );
    }
  }

  async function undoStatus() {
    if (!toast) {
      return;
    }

    const { job, previousStatus } = toast;
    setToast(null);
    await updateStatus(job, previousStatus);
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
          ].map(([value, label]) => (
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

        <label className="paper-field">
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
        <span className="font-mono text-xs text-[var(--ink-faint)]">
          {filteredJobs.length} roles
        </span>
      </div>

      <div className="mb-5">
        <button
          className="paper-btn paper-btn-ghost"
          onClick={() => setShowHidden((value) => !value)}
          type="button"
        >
          {showHidden ? "Hide Passed/Archived" : "Show Passed/Archived"}
        </button>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="paper-card paper-empty">
          <h2 className="text-lg font-bold text-[var(--ink)]">No roles match</h2>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Adjust the filter, search, or hidden-status toggle.
          </p>
        </div>
      ) : (
        <section className="flex flex-col gap-[18px]">
          {filteredJobs.map((job) => (
            <TodayCard
              highFitThreshold={highFitThreshold}
              isOpen={openIds.has(job.jobId)}
              job={job}
              key={job.recommendationId}
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

      {toast ? (
        <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-white shadow-xl">
          <span>{toast.message}</span>
          <button
            className="font-bold text-[var(--accent-border)]"
            onClick={undoStatus}
            type="button"
          >
            Undo
          </button>
        </div>
      ) : null}
    </>
  );
}
