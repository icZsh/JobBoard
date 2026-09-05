import Link from "next/link";
import type { ReactNode } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Columns3,
  Database,
  History,
  Settings,
  Upload,
  XCircle,
} from "lucide-react";
import { ImportRunStatus } from "@/generated/prisma/client";
import { formatDateOnly, formatStatusLabel, formatTimestamp } from "@/lib/format";
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
  const className =
    status === ImportRunStatus.SUCCESS
      ? "badge-apply"
      : status === ImportRunStatus.FAILED
        ? "badge-pass"
        : "badge-neutral";
  const Icon =
    status === ImportRunStatus.SUCCESS
      ? CheckCircle2
      : status === ImportRunStatus.FAILED
        ? XCircle
        : Clock3;

  return (
    <span className={`paper-badge ${className}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {formatStatusLabel(status)}
    </span>
  );
}

function SidebarSection({
  eyebrow,
  title,
  icon,
  children,
}: {
  eyebrow: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="paper-card">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-ctl)] border border-[var(--hair)] bg-[var(--surface-2)] text-[var(--accent-ink)]">
          {icon}
        </span>
        <div>
          <p className="paper-label">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-bold text-[var(--ink)]">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

export default async function ImportPage() {
  const recentRuns = await getRecentImportRuns();
  const successfulRuns = recentRuns.filter(
    (run) => run.status === ImportRunStatus.SUCCESS,
  ).length;

  return (
    <main className="paper-app">
      <div className="paper-wrap paper-wrap-board">
        <header className="paper-head">
          <div>
            <p className="paper-eyebrow">Daily Payload</p>
            <h1 className="paper-title">Import</h1>
            <p className="paper-sub">
              {recentRuns.length} recent runs ·{" "}
              <strong>{successfulRuns} successful</strong>
            </p>
          </div>
          <div className="paper-actions">
            <Link className="paper-btn" href="/today">
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              Today
            </Link>
            <Link className="paper-btn" href="/board">
              <Columns3 className="h-4 w-4" aria-hidden="true" />
              Board
            </Link>
            <Link className="paper-btn" href="/settings">
              <Settings className="h-4 w-4" aria-hidden="true" />
              Settings
            </Link>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ImportClient />

          <aside className="grid h-fit gap-5">
            <SidebarSection
              eyebrow="Runs"
              icon={<History className="h-[18px] w-[18px]" aria-hidden="true" />}
              title="Recent Runs"
            >
              {recentRuns.length === 0 ? (
                <p className="mt-5 text-sm text-[var(--ink-soft)]">
                  No imports yet.
                </p>
              ) : (
                <div className="mt-5 grid gap-3">
                  {recentRuns.map((run) => (
                    <div
                      className="rounded-[14px] border border-[var(--hair)] bg-[var(--surface-2)] p-4 text-sm"
                      key={run.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-sm font-semibold text-[var(--ink)]">
                            {formatDateOnly(run.runDate)}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                            {run.sourceName ?? "Unknown source"} ·{" "}
                            {formatTimestamp(run.createdAt)}
                          </p>
                        </div>
                        <StatusBadge status={run.status} />
                      </div>
                      <p className="mt-3 font-mono text-[11.5px] font-semibold text-[var(--ink-faint)]">
                        {run._count.recommendations} recommendations
                      </p>
                      {run.errorMessage ? (
                        <p className="mt-2 text-xs leading-5 text-[var(--pass-ink)]">
                          {run.errorMessage}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </SidebarSection>

            <SidebarSection
              eyebrow="Storage"
              icon={<Database className="h-[18px] w-[18px]" aria-hidden="true" />}
              title="Local Database"
            >
              <div className="mt-5 border-t border-[var(--hair)] pt-5">
                <span className="paper-badge badge-neutral">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  Postgres import target
                </span>
              </div>
            </SidebarSection>
          </aside>
        </section>
      </div>
    </main>
  );
}
