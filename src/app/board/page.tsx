import Link from "next/link";
import { JobStatus, type Priority } from "@/generated/prisma/client";
import { formatDateOnly, formatSalary, formatStatusLabel } from "@/lib/format";
import { getLatestRecommendation } from "@/lib/jobs/recommendations";
import { jobStatusOptions } from "@/lib/jobs/tracking";
import { prisma } from "@/lib/prisma";
import { updateBoardJobStatus } from "./actions";

export const dynamic = "force-dynamic";

type BoardJob = Awaited<ReturnType<typeof getBoardJobs>>[number];

const priorityStyles: Record<Priority, string> = {
  LOW: "border-slate-200 bg-slate-50 text-slate-600",
  MEDIUM: "border-sky-200 bg-sky-50 text-sky-700",
  HIGH: "border-amber-200 bg-amber-50 text-amber-800",
  URGENT: "border-rose-200 bg-rose-50 text-rose-700",
};

async function getBoardJobs() {
  return prisma.job.findMany({
    include: {
      tracking: true,
      recommendations: {
        include: {
          importRun: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
}

function BoardCard({ job }: { job: BoardJob }) {
  const tracking = job.tracking;
  const status = tracking?.status ?? JobStatus.NEW;
  const latestRecommendation = getLatestRecommendation(job.recommendations);
  const salary = formatSalary(job.salaryMin, job.salaryMax);

  return (
    <article className="border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-950">{job.title}</h3>
          <p className="mt-1 text-xs text-slate-600">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
          </p>
        </div>
        {latestRecommendation?.priority ? (
          <span
            className={`shrink-0 border px-1.5 py-1 text-[11px] font-medium ${priorityStyles[latestRecommendation.priority]}`}
          >
            {latestRecommendation.priority}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-1 text-xs text-slate-600">
        <p>Fit: {latestRecommendation?.fitScore ?? "Not scored"}</p>
        {salary ? <p>{salary}</p> : null}
        <p>Last seen: {formatDateOnly(job.lastImportedAt)}</p>
      </div>

      <form action={updateBoardJobStatus} className="mt-3 flex gap-2">
        <input type="hidden" name="jobId" value={job.id} />
        <select
          className="h-8 min-w-0 flex-1 border border-slate-200 bg-white px-2 text-xs text-slate-700"
          defaultValue={status}
          name="status"
        >
          {jobStatusOptions.map((option) => (
            <option key={option} value={option}>
              {formatStatusLabel(option)}
            </option>
          ))}
        </select>
        <button
          className="h-8 border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:border-slate-400"
          type="submit"
        >
          Move
        </button>
      </form>

      <div className="mt-3 flex gap-2 text-xs">
        <Link
          className="border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:border-slate-400"
          href={`/jobs/${job.id}`}
        >
          Details
        </Link>
        {job.sourceUrl ? (
          <a
            className="border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:border-slate-400"
            href={job.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Apply
          </a>
        ) : null}
      </div>
    </article>
  );
}

export default async function BoardPage() {
  const jobs = await getBoardJobs();
  const jobsByStatus = new Map(
    jobStatusOptions.map((status) => [
      status,
      jobs.filter((job) => (job.tracking?.status ?? JobStatus.NEW) === status),
    ]),
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              Pipeline
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Board
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {jobs.length} tracked {jobs.length === 1 ? "job" : "jobs"}
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
              href="/import"
            >
              Import
            </Link>
            <Link
              className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              href="/settings"
            >
              Settings
            </Link>
          </div>
        </header>

        {jobs.length === 0 ? (
          <div className="border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">
              No jobs on the board yet
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Import a daily recommendation payload to start tracking roles.
            </p>
          </div>
        ) : (
          <section className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-4">
            {jobStatusOptions.map((status) => {
              const statusJobs = jobsByStatus.get(status) ?? [];

              return (
                <section key={status} className="min-w-0">
                  <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2">
                    <h2 className="text-sm font-semibold text-slate-900">
                      {formatStatusLabel(status)}
                    </h2>
                    <span className="text-xs text-slate-500">
                      {statusJobs.length}
                    </span>
                  </div>
                  <div className="grid gap-3">
                    {statusJobs.map((job) => (
                      <BoardCard job={job} key={job.id} />
                    ))}
                  </div>
                </section>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
