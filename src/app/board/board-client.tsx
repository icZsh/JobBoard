"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { formatStatusLabel } from "@/lib/format";

export const boardStatuses = [
  "NEW",
  "INTERESTED",
  "APPLYING",
  "APPLIED",
  "INTERVIEWING",
  "OFFER",
  "REJECTED",
  "PASSED",
  "ARCHIVED",
] as const;

export type BoardJobItem = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  sourceUrl: string | null;
  status: string;
  statusHue: string;
  fitScore: number | null;
  salary: string | null;
  priority: string | null;
  priorityClass: string;
  lastSeen: string;
};

function getStatusHue(status: string) {
  const hues: Record<string, string> = {
    NEW: "var(--st-new)",
    INTERESTED: "var(--st-interested)",
    APPLYING: "var(--st-applying)",
    APPLIED: "var(--st-applied)",
    INTERVIEWING: "var(--st-interviewing)",
    OFFER: "var(--st-offer)",
    REJECTED: "var(--st-rejected)",
    PASSED: "var(--st-passed)",
    ARCHIVED: "var(--st-archived)",
  };

  return hues[status] ?? "var(--ink-faint)";
}

function BoardCard({
  job,
  landed,
  onDragStart,
  onMove,
}: {
  job: BoardJobItem;
  landed: boolean;
  onDragStart: () => void;
  onMove: (status: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const score = job.fitScore ?? 0;

  return (
    <article
      className={`relative cursor-grab rounded-[14px] border border-[var(--hair)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-card)] transition hover:-translate-y-px hover:border-[var(--hair-strong)] hover:shadow-[var(--shadow-card-hover)] ${
        landed ? "ring-2 ring-[var(--accent-border)]" : ""
      }`}
      draggable
      onDragStart={onDragStart}
      style={{ "--status-hue": job.statusHue } as CSSProperties}
    >
      <span className="absolute bottom-3 left-0 top-3 w-[3px] rounded-full bg-[var(--status-hue)]" />
      <h3 className="pl-2 text-[13.5px] font-bold leading-snug text-[var(--ink)]">
        <Link className="paper-link" href={`/jobs/${job.id}`}>
          {job.title}
        </Link>
      </h3>
      <p className="mt-1 pl-2 text-xs text-[var(--ink-soft)]">
        {job.company}
        {job.location ? ` · ${job.location}` : ""}
      </p>

      <div className="mt-3 flex items-center gap-2 pl-2">
        <div className="flex items-center gap-1.5 font-mono text-[11.5px] font-semibold text-[var(--accent-ink)]">
          <span
            className="fit-ring fit-ring-sm"
            style={{ "--score": score } as CSSProperties}
          />
          {job.fitScore ?? "-"}
        </div>
        {job.salary ? (
          <span className="font-mono text-[11.5px] text-[var(--ink-soft)]">
            {job.salary}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--hair)] pl-2 pt-3">
        <span className="font-mono text-[10.5px] text-[var(--ink-faint)]">
          Seen {job.lastSeen}
        </span>
        <div className="relative flex items-center gap-1.5">
          {job.priority ? (
            <span className={`paper-badge px-2 py-1 text-[9.5px] ${job.priorityClass}`}>
              {job.priority}
            </span>
          ) : null}
          <button
            className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] border border-[var(--hair)] bg-[var(--surface-2)] text-[var(--ink-faint)] hover:border-[var(--ink-faint)] hover:text-[var(--ink)]"
            onClick={() => setMenuOpen((value) => !value)}
            type="button"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {menuOpen ? (
            <div className="absolute bottom-8 right-0 z-20 flex min-w-40 flex-col gap-1 rounded-[11px] border border-[var(--hair-strong)] bg-[var(--surface)] p-1 shadow-2xl">
              {boardStatuses
                .filter((status) => status !== job.status)
                .map((status) => (
                  <button
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                    key={status}
                    onClick={() => {
                      setMenuOpen(false);
                      onMove(status);
                    }}
                    type="button"
                  >
                    <span
                      className="status-dot"
                      style={
                        { "--status-hue": getStatusHue(status) } as CSSProperties
                      }
                    />
                    {formatStatusLabel(status)}
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function BoardClient({ jobs }: { jobs: BoardJobItem[] }) {
  const [items, setItems] = useState(jobs);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);

  const grouped = useMemo(
    () =>
      new Map(
        boardStatuses.map((status) => [
          status,
          items.filter((job) => job.status === status),
        ]),
      ),
    [items],
  );
  const activeCount = items.filter(
    (job) => !["REJECTED", "PASSED", "ARCHIVED"].includes(job.status),
  ).length;
  const interviewingPlus = items.filter((job) =>
    ["INTERVIEWING", "OFFER"].includes(job.status),
  ).length;
  const offers = items.filter((job) => job.status === "OFFER").length;

  async function moveJob(jobId: string, status: string) {
    const previous = items.find((job) => job.id === jobId);

    if (!previous || previous.status === status) {
      return;
    }

    setItems((current) =>
      current.map((job) =>
        job.id === jobId
          ? { ...job, status, statusHue: getStatusHue(status) }
          : job,
      ),
    );
    setLandedId(jobId);
    window.setTimeout(() => setLandedId(null), 450);

    try {
      const response = await fetch(`/api/jobs/${jobId}/tracking`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error("Move failed.");
      }
    } catch {
      setItems((current) =>
        current.map((job) => (job.id === jobId ? previous : job)),
      );
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2.5">
        {[
          ["tracked", items.length],
          ["active", activeCount],
          ["interviewing+", interviewingPlus],
          ["offers", offers],
        ].map(([label, value]) => (
          <span
            className={`inline-flex items-baseline gap-2 rounded-full border border-[var(--hair)] bg-[var(--surface)] px-4 py-2 ${
              label === "active" ? "text-[var(--accent-ink)]" : ""
            }`}
            key={label}
          >
            <span className="font-mono text-[15px] font-bold">{value}</span>
            <span className="text-xs text-[var(--ink-soft)]">{label}</span>
          </span>
        ))}
      </div>
      <p className="mb-5 font-mono text-xs text-[var(--ink-faint)]">
        Drag cards across columns or use the move menu on each card.
      </p>

      <section className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-6">
        {boardStatuses.map((status) => {
          const statusJobs = grouped.get(status) ?? [];
          const hue = getStatusHue(status);

          return (
            <section
              className="w-[290px] flex-[0_0_290px] snap-start"
              key={status}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(status);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingId) {
                  void moveJob(draggingId, status);
                }
                setDraggingId(null);
                setDragOver(null);
              }}
            >
              <div className="mb-3 flex items-center gap-2 border-b border-[var(--hair-strong)] px-1 pb-3">
                <span
                  className="status-dot"
                  style={{ "--status-hue": hue } as CSSProperties}
                />
                <h2 className="text-sm font-bold text-[var(--ink)]">
                  {formatStatusLabel(status)}
                </h2>
                <span className="ml-auto inline-flex h-5 min-w-6 items-center justify-center rounded-full border border-[var(--hair)] bg-[var(--surface-2)] px-1.5 font-mono text-[11.5px] text-[var(--ink-faint)]">
                  {statusJobs.length}
                </span>
              </div>

              <div
                className={`flex min-h-20 flex-col gap-2.5 rounded-[11px] p-1 transition ${
                  dragOver === status
                    ? "bg-[var(--accent-bg)] ring-1 ring-[var(--accent-border)]"
                    : ""
                }`}
              >
                {statusJobs.length === 0 ? (
                  <div className="rounded-[11px] border border-dashed border-[var(--hair-strong)] px-3 py-5 text-center font-mono text-xs text-[var(--ink-faint)]">
                    Empty<br />
                    Drop here
                  </div>
                ) : (
                  statusJobs.map((job) => (
                    <BoardCard
                      job={job}
                      key={job.id}
                      landed={landedId === job.id}
                      onDragStart={() => setDraggingId(job.id)}
                      onMove={(nextStatus) => void moveJob(job.id, nextStatus)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </section>
    </>
  );
}
