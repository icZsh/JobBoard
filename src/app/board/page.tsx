import Link from "next/link";
import { requireAdmin } from "@/lib/auth/authorization";
import { JobStatus } from "@/generated/prisma/client";
import { formatDateOnly } from "@/lib/format";
import { getLatestRecommendation } from "@/lib/jobs/recommendations";
import {
  formatCompactSalary,
  priorityBadgeClass,
  statusHueByStatus,
} from "@/lib/jobs/view";
import { prisma } from "@/lib/prisma";
import { BoardClient, type BoardJobItem } from "./board-client";

export const dynamic = "force-dynamic";

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

type BoardJob = Awaited<ReturnType<typeof getBoardJobs>>[number];

function toBoardItem(job: BoardJob): BoardJobItem {
  const status = job.tracking?.status ?? JobStatus.NEW;
  const latestRecommendation = getLatestRecommendation(job.recommendations);

  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    sourceUrl: job.sourceUrl,
    status,
    statusHue: statusHueByStatus[status],
    fitScore: latestRecommendation?.fitScore ?? null,
    salary: formatCompactSalary(job.salaryMin, job.salaryMax),
    priority: latestRecommendation?.priority ?? null,
    priorityClass: priorityBadgeClass(latestRecommendation?.priority),
    lastSeen: formatDateOnly(job.lastImportedAt),
  };
}

export default async function BoardPage() {
  await requireAdmin("/board");
  const jobs = await getBoardJobs();
  const items = jobs.map(toBoardItem);
  const activeCount = items.filter(
    (job) => !["REJECTED", "PASSED", "ARCHIVED"].includes(job.status),
  ).length;

  return (
    <main className="paper-app">
      <div className="paper-wrap paper-wrap-board">
        <header className="paper-head board-head">
          <div>
            <p className="paper-eyebrow">Pipeline</p>
            <h1 className="paper-title">Board</h1>
            <p className="paper-sub">
              {items.length} roles tracked · <strong>{activeCount} active</strong>
            </p>
          </div>
          <div className="paper-actions">
            <Link className="paper-btn" href="/today">
              Today
            </Link>
            <Link className="paper-btn" href="/import">
              Import
            </Link>
            <Link className="paper-btn" href="/settings">
              Settings
            </Link>
          </div>
        </header>

        {items.length === 0 ? (
          <div className="paper-card paper-empty">
            <h2 className="text-lg font-bold text-[var(--ink)]">
              No jobs on the board yet
            </h2>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              Import a daily recommendation payload to start tracking roles.
            </p>
          </div>
        ) : (
          <BoardClient jobs={items} />
        )}
      </div>
    </main>
  );
}
