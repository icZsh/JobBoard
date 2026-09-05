import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { JobStatus } from "@/generated/prisma/client";
import {
  formatDateInput,
  formatDateOnly,
  formatSalary,
  formatStatusLabel,
  formatTimestamp,
} from "@/lib/format";
import { sanitizeJobDescription } from "@/lib/jobs/description";
import { isApplyTodayJob, isHighFit } from "@/lib/jobs/prioritization";
import {
  getLatestRecommendation,
  sortRecommendationsByLatest,
} from "@/lib/jobs/recommendations";
import { jobStatusOptions } from "@/lib/jobs/tracking";
import {
  formatCompactSalary,
  getFitTier,
  priorityBadgeClass,
  statusHueByStatus,
} from "@/lib/jobs/view";
import { prisma } from "@/lib/prisma";
import { getHighFitThreshold } from "@/lib/settings";
import { TrackingForm } from "./tracking-form";

export const dynamic = "force-dynamic";

type JobDetailPageProps = {
  params: Promise<{ id: string }>;
};

async function getJob(id: string) {
  return prisma.job.findUnique({
    where: { id },
    include: {
      tracking: true,
      recommendations: {
        include: {
          importRun: true,
        },
      },
    },
  });
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="paper-card">
      <h2 className="paper-label mb-4 flex items-center gap-3">
        {title}
        <span className="h-px flex-1 bg-[var(--hair)]" />
      </h2>
      {children}
    </section>
  );
}

function MetadataCell({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="paper-label">{label}</p>
      <p
        className={`mt-1.5 text-sm text-[var(--ink)] ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function SkillChips({
  label,
  skills,
  missing,
}: {
  label: string;
  skills: string[];
  missing?: boolean;
}) {
  return (
    <div>
      <h3 className="paper-label mb-2">{label}</h3>
      {skills.length === 0 ? (
        <p className="text-sm text-[var(--ink-faint)]">None</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <span
              className={`paper-badge text-[11px] ${
                missing ? "badge-pass" : "badge-apply"
              }`}
              key={skill}
            >
              {skill}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { id } = await params;

  const [job, highFitThreshold] = await Promise.all([
    getJob(id),
    getHighFitThreshold(),
  ]);

  if (!job) {
    notFound();
  }

  const tracking = job.tracking;
  const status = tracking?.status ?? JobStatus.NEW;
  const statusHue = statusHueByStatus[status];
  const latestRecommendation = getLatestRecommendation(job.recommendations);
  const recommendationHistory = sortRecommendationsByLatest(job.recommendations);
  const salary = formatSalary(job.salaryMin, job.salaryMax);
  const compactSalary = formatCompactSalary(job.salaryMin, job.salaryMax);
  const fitScore = latestRecommendation?.fitScore ?? null;
  const fitTier = getFitTier(fitScore);
  const highFit = isHighFit(fitScore, highFitThreshold);
  const applyToday = latestRecommendation
    ? isApplyTodayJob({
        fitScore,
        concerns: latestRecommendation.concerns,
        status,
        suggestedAction: latestRecommendation.suggestedAction,
        highFitThreshold,
      })
    : false;
  const sanitizedDescription = job.description
    ? sanitizeJobDescription(job.description)
    : null;
  const statusOptions = jobStatusOptions.map((value) => ({
    value,
    hue: statusHueByStatus[value],
  }));

  return (
    <main className="paper-app">
      <div className="paper-wrap paper-wrap-detail">
        <Link className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-soft)] hover:text-[var(--accent-ink)]" href="/board">
          <ArrowLeft className="h-4 w-4" />
          Back to Board
        </Link>

        <header className="mb-7 flex flex-col gap-7 border-b border-[var(--hair-strong)] pb-7 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="paper-eyebrow">Job Detail</p>
            <h1 className="mt-3 text-[40px] font-extrabold leading-tight text-[var(--ink)] max-md:text-[30px]">
              {job.title}
            </h1>
            <p className="mt-3 text-[15px] text-[var(--ink-soft)]">
              <strong className="text-[var(--ink)]">{job.company}</strong>
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
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="paper-badge badge-neutral">
                <span
                  className="status-dot"
                  style={{ "--status-hue": statusHue } as CSSProperties}
                />
                {formatStatusLabel(status)}
              </span>
              {applyToday ? (
                <span className="paper-badge badge-apply">Apply Today</span>
              ) : null}
              {highFit ? (
                <span className="paper-badge badge-fit">High Fit</span>
              ) : null}
              {latestRecommendation?.priority ? (
                <span
                  className={`paper-badge ${priorityBadgeClass(
                    latestRecommendation.priority,
                  )}`}
                >
                  {formatStatusLabel(latestRecommendation.priority)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="paper-panel flex items-center gap-6 p-5">
            <div className="flex flex-col items-center gap-2">
              <div
                className="fit-ring h-[84px] w-[84px]"
                style={{ "--score": fitScore ?? 0 } as CSSProperties}
              >
                <span className="text-[26px]">{fitScore ?? "-"}</span>
              </div>
              <p className="paper-label">Fit Score</p>
            </div>
            <span className="self-stretch border-l border-[var(--hair)]" />
            <div>
              <p className="paper-label">Compensation</p>
              <p className="mt-2 whitespace-nowrap font-mono text-[19px] text-[var(--ink)]">
                {compactSalary ?? "Not listed"}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">{fitTier}</p>
            </div>
          </div>
        </header>

        <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_348px]">
          <div className="flex min-w-0 flex-col gap-5">
            <Section title="Why this matched">
              {latestRecommendation ? (
                <>
                  <p className="text-[15px] leading-7 text-[var(--ink)]">
                    {latestRecommendation.matchReason ??
                      "No match reason was included for this recommendation."}
                  </p>
                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                    <SkillChips
                      label="Matched skills"
                      skills={latestRecommendation.matchedSkills}
                    />
                    <SkillChips
                      label="Gaps"
                      missing
                      skills={latestRecommendation.missingSkills}
                    />
                  </div>
                  {latestRecommendation.concerns ? (
                    <div className="mt-5 flex gap-3 rounded-[var(--radius-ctl)] border border-[var(--high-border)] bg-[var(--high-bg)] p-4">
                      <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-[var(--high-ink)]" />
                      <div>
                        <p className="paper-label text-[var(--high-ink)]">
                          Concerns
                        </p>
                        <p className="mt-1 text-sm leading-6 text-[#7a4e12]">
                          {latestRecommendation.concerns}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-[var(--ink-soft)]">
                  No recommendation history found for this job.
                </p>
              )}
            </Section>

            <Section title="Role details">
              <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <MetadataCell label="Salary" mono value={salary ?? "Not listed"} />
                <MetadataCell
                  label="Remote"
                  value={job.remoteType ?? job.location ?? "Unknown"}
                />
                <MetadataCell
                  label="Date Posted"
                  value={job.datePosted ? formatDateOnly(job.datePosted) : "Unknown"}
                />
                <MetadataCell
                  label="First Seen"
                  value={formatTimestamp(job.createdAt)}
                />
                <MetadataCell
                  label="Last Imported"
                  value={formatTimestamp(job.lastImportedAt)}
                />
                <MetadataCell
                  label="Suggested Action"
                  value={latestRecommendation?.suggestedAction ?? "None"}
                />
              </dl>
            </Section>

            <Section title="Description">
              {sanitizedDescription ? (
                <div
                  className="paper-prose"
                  dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
                />
              ) : (
                <p className="text-sm text-[var(--ink-soft)]">
                  No description was imported for this job.
                </p>
              )}
            </Section>

            <Section title="Import history">
              {recommendationHistory.length > 0 ? (
                <div className="relative pl-6 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-0.5 before:bg-[var(--hair)]">
                  {recommendationHistory.map((recommendation, index) => {
                    const previous = recommendationHistory[index + 1];
                    const currentScore = recommendation.fitScore;
                    const previousScore = previous?.fitScore;
                    const delta =
                      typeof currentScore === "number" &&
                      typeof previousScore === "number"
                        ? currentScore - previousScore
                        : null;

                    return (
                      <div className="relative pb-5 last:pb-0" key={recommendation.id}>
                        <span
                          className={`absolute -left-6 top-1 h-3 w-3 rounded-full border-2 ${
                            index === 0
                              ? "border-[var(--accent)] bg-[var(--accent)]"
                              : "border-[var(--hair-strong)] bg-[var(--surface)]"
                          }`}
                        />
                        <div className="flex flex-wrap items-baseline gap-2">
                          <p className="text-sm font-bold text-[var(--ink)]">
                            {formatDateOnly(recommendation.importRun.runDate)}
                          </p>
                          <p className="font-mono text-[11px] text-[var(--ink-faint)]">
                            {recommendation.importRun.sourceName ?? "Unknown source"}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-[var(--ink-soft)]">
                          Fit {currentScore ?? "Not scored"}
                          {delta === null ? "" : ` · ${delta >= 0 ? "+" : ""}${delta}`}
                          {index === 0 ? " · current run" : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-[var(--ink-soft)]">
                  No import history is available.
                </p>
              )}
            </Section>
          </div>

          <TrackingForm
            initial={{
              status,
              notes: tracking?.notes ?? "",
              nextAction: tracking?.nextAction ?? "",
              nextActionDate: formatDateInput(tracking?.nextActionDate),
              appliedAt: formatDateInput(tracking?.appliedAt),
              resumePath: tracking?.resumePath ?? "",
              resumeVersion: tracking?.resumeVersion ?? "",
            }}
            jobId={job.id}
            sourceUrl={job.sourceUrl}
            statusOptions={statusOptions}
          />
        </section>
      </div>
    </main>
  );
}
