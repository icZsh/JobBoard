import Link from "next/link";
import { notFound } from "next/navigation";
import { JobStatus, type Priority } from "@/generated/prisma/client";
import {
  formatDateInput,
  formatDateOnly,
  formatSalary,
  formatStatusLabel,
  formatTimestamp,
} from "@/lib/format";
import { sanitizeJobDescription } from "@/lib/jobs/description";
import { getLatestRecommendation, sortRecommendationsByLatest } from "@/lib/jobs/recommendations";
import { jobStatusOptions } from "@/lib/jobs/tracking";
import { prisma } from "@/lib/prisma";
import { updateJobDetailTracking } from "./actions";

export const dynamic = "force-dynamic";

type JobDetailPageProps = {
  params: Promise<{ id: string }>;
};

const priorityStyles: Record<Priority, string> = {
  LOW: "border-slate-200 bg-slate-50 text-slate-600",
  MEDIUM: "border-sky-200 bg-sky-50 text-sky-700",
  HIGH: "border-amber-200 bg-amber-50 text-amber-800",
  URGENT: "border-rose-200 bg-rose-50 text-rose-700",
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

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function SkillList({ skills }: { skills: string[] }) {
  if (skills.length === 0) {
    return <span className="text-slate-500">None</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {skills.map((skill) => (
        <span
          className="border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
          key={skill}
        >
          {skill}
        </span>
      ))}
    </div>
  );
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    notFound();
  }

  const tracking = job.tracking;
  const latestRecommendation = getLatestRecommendation(job.recommendations);
  const recommendationHistory = sortRecommendationsByLatest(job.recommendations);
  const salary = formatSalary(job.salaryMin, job.salaryMax);
  const sanitizedDescription = job.description
    ? sanitizeJobDescription(job.description)
    : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Job Detail
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              {job.title}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {job.company}
              {job.location ? ` · ${job.location}` : ""}
              {job.remoteType ? ` · ${job.remoteType}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              href="/today"
            >
              Today
            </Link>
            <Link
              className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              href="/board"
            >
              Board
            </Link>
            {job.sourceUrl ? (
              <a
                className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
                href={job.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                Source
              </a>
            ) : null}
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-6">
            <section className="border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">
                Listing
              </h2>
              <dl className="mt-4 grid gap-4 md:grid-cols-3">
                <Field label="Salary" value={salary ?? "Not listed"} />
                <Field
                  label="Date Posted"
                  value={job.datePosted ? formatDateOnly(job.datePosted) : "Unknown"}
                />
                <Field label="First Seen" value={formatTimestamp(job.createdAt)} />
                <Field
                  label="Last Imported"
                  value={formatTimestamp(job.lastImportedAt)}
                />
                <Field
                  label="Status Changed"
                  value={
                    tracking?.statusChangedAt
                      ? formatTimestamp(tracking.statusChangedAt)
                      : "Unknown"
                  }
                />
                <Field
                  label="Applied"
                  value={
                    tracking?.appliedAt ? formatDateOnly(tracking.appliedAt) : "No"
                  }
                />
              </dl>
            </section>

            <section className="border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">
                Recommendation
              </h2>
              {latestRecommendation ? (
                <div className="mt-4 grid gap-4">
                  <div className="flex flex-wrap gap-2">
                    <span className="border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                      Fit {latestRecommendation.fitScore ?? "Not scored"}
                    </span>
                    {latestRecommendation.priority ? (
                      <span
                        className={`border px-2 py-1 text-xs font-medium ${priorityStyles[latestRecommendation.priority]}`}
                      >
                        {latestRecommendation.priority}
                      </span>
                    ) : null}
                  </div>
                  <dl className="grid gap-4 md:grid-cols-2">
                    <Field
                      label="Suggested Action"
                      value={latestRecommendation.suggestedAction ?? "None"}
                    />
                    <Field
                      label="Match Reason"
                      value={latestRecommendation.matchReason ?? "None"}
                    />
                    <Field
                      label="Concerns"
                      value={latestRecommendation.concerns ?? "None"}
                    />
                    <Field
                      label="Run"
                      value={formatDateOnly(latestRecommendation.importRun.runDate)}
                    />
                  </dl>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-500">
                        Matched Skills
                      </p>
                      <div className="mt-2">
                        <SkillList skills={latestRecommendation.matchedSkills} />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-500">
                        Missing Skills
                      </p>
                      <div className="mt-2">
                        <SkillList skills={latestRecommendation.missingSkills} />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-600">
                  No recommendation history found for this job.
                </p>
              )}
            </section>

            <section className="border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">
                Description
              </h2>
              {sanitizedDescription ? (
                <div
                  className="prose prose-sm mt-4 max-w-none text-slate-700"
                  dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
                />
              ) : (
                <p className="mt-3 text-sm text-slate-600">
                  No description was imported for this job.
                </p>
              )}
            </section>

            <section className="border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">
                Import History
              </h2>
              {recommendationHistory.length > 0 ? (
                <div className="mt-4 grid gap-3">
                  {recommendationHistory.map((recommendation) => (
                    <div
                      className="border border-slate-100 bg-slate-50 p-3 text-sm"
                      key={recommendation.id}
                    >
                      <p className="font-medium text-slate-900">
                        {formatDateOnly(recommendation.importRun.runDate)}
                        {recommendation.importRun.sourceName
                          ? ` · ${recommendation.importRun.sourceName}`
                          : ""}
                      </p>
                      <p className="mt-1 text-slate-600">
                        Fit {recommendation.fitScore ?? "Not scored"}
                        {recommendation.priority
                          ? ` · ${recommendation.priority}`
                          : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-600">
                  No import history is available.
                </p>
              )}
            </section>
          </div>

          <aside className="h-fit border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">
              Tracking
            </h2>
            <form action={updateJobDetailTracking} className="mt-4 grid gap-4">
              <input type="hidden" name="jobId" value={job.id} />
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Status</span>
                <select
                  className="h-10 border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  defaultValue={tracking?.status ?? JobStatus.NEW}
                  name="status"
                >
                  {jobStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Notes</span>
                <textarea
                  className="min-h-28 border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  defaultValue={tracking?.notes ?? ""}
                  name="notes"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Next Action</span>
                <input
                  className="h-10 border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  defaultValue={tracking?.nextAction ?? ""}
                  name="nextAction"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Next Action Date</span>
                <input
                  className="h-10 border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  defaultValue={formatDateInput(tracking?.nextActionDate)}
                  name="nextActionDate"
                  type="date"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Applied Date</span>
                <input
                  className="h-10 border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  defaultValue={formatDateInput(tracking?.appliedAt)}
                  name="appliedAt"
                  type="date"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Resume Path</span>
                <input
                  className="h-10 border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  defaultValue={tracking?.resumePath ?? ""}
                  name="resumePath"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Resume Version</span>
                <input
                  className="h-10 border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  defaultValue={tracking?.resumeVersion ?? ""}
                  name="resumeVersion"
                />
              </label>
              <button
                className="h-10 border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
                type="submit"
              >
                Save Tracking
              </button>
            </form>
          </aside>
        </section>
      </div>
    </main>
  );
}
