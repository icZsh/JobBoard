import Link from "next/link";
import { ImportRunStatus } from "@/generated/prisma/client";
import { formatDateOnly, formatTimestamp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

async function getRecentImportRuns() {
  return prisma.importRun.findMany({
    include: {
      _count: {
        select: {
          recommendations: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 8,
  });
}

function StatusBadge({ status }: { status: ImportRunStatus }) {
  const style =
    status === ImportRunStatus.SUCCESS
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === ImportRunStatus.FAILED
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={`border px-2 py-1 text-xs font-medium ${style}`}>
      {status}
    </span>
  );
}

export default async function ImportPage() {
  const recentRuns = await getRecentImportRuns();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              Daily Payload
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Import
            </h1>
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
            <Link
              className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              href="/settings"
            >
              Settings
            </Link>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ImportClient />

          <aside className="h-fit border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">
              Recent Runs
            </h2>
            {recentRuns.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No imports yet.</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {recentRuns.map((run) => (
                  <div
                    className="border border-slate-100 bg-slate-50 p-3 text-sm"
                    key={run.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">
                          {formatDateOnly(run.runDate)}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {run.sourceName ?? "Unknown source"} ·{" "}
                          {formatTimestamp(run.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={run.status} />
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      {run._count.recommendations} recommendations
                    </p>
                    {run.errorMessage ? (
                      <p className="mt-2 text-xs text-rose-700">
                        {run.errorMessage}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
