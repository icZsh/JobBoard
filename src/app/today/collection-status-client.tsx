"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Run = {
  id: string;
  status: string;
  error: string | null;
  report: unknown;
  createdAt: string;
  finishedAt: string | null;
};
type Source = {
  company: string;
  status: string;
  postings: number;
  error?: string;
};

function sourcesOf(report: unknown): Source[] {
  if (
    !report ||
    typeof report !== "object" ||
    !("sources" in report) ||
    !Array.isArray(report.sources)
  )
    return [];
  return report.sources.filter((source): source is Source =>
    Boolean(
      source &&
      typeof source === "object" &&
      typeof source.company === "string",
    ),
  );
}

export function CollectionStatusClient({
  runs,
  timezone,
  nextRun,
  lastSuccess,
}: {
  runs: Run[];
  timezone: string;
  nextRun: string | null;
  lastSuccess: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = runs[0];
  const active = runs.some((run) =>
    ["QUEUED", "RUNNING", "PUBLISHING"].includes(run.status),
  );
  const sources = sourcesOf(latest?.report);
  const failed = sources.filter((source) => source.status === "failed");
  const succeeded = sources.filter(
    (source) => source.status === "success",
  ).length;
  const time = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  useEffect(() => {
    const timer = setInterval(
      () => {
        if (!document.hidden) router.refresh();
      },
      active ? 4000 : 60000,
    );
    return () => clearInterval(timer);
  }, [active, router]);

  async function collect() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/collection-runs", { method: "POST" });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.errorMessage ?? "Could not start collection.");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start collection.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const status = !latest
    ? "Ready for your first collection"
    : latest.status === "EMPTY"
      ? "This collection found no matching jobs"
      : latest.status === "FAILED"
        ? "Latest collection failed"
        : latest.status === "PARTIAL"
          ? "Collection completed with partial coverage"
          : latest.status === "SUCCESS"
            ? "Collection completed"
            : latest.status === "QUEUED"
              ? "Collection queued"
              : latest.status === "PUBLISHING"
                ? "Saving recommendations"
                : "Collecting jobs";

  return (
    <section
      className="paper-card mb-5"
      aria-label="Collection status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="paper-label">Automatic collection</p>
          <h2 className="mt-2 text-lg font-bold">{status}</h2>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            {latest
              ? `Latest: ${time(latest.finishedAt ?? latest.createdAt)}. `
              : ""}
            {sources.length > 0
              ? `${succeeded}/${sources.length} sources succeeded. `
              : ""}
            {nextRun ? `Next: ${time(nextRun)}` : "Schedule paused"} ·{" "}
            {timezone}
          </p>
          {lastSuccess ? (
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              Last successful collection: {time(lastSuccess)}
            </p>
          ) : null}
        </div>
        <div className="paper-actions">
          <Link href="/settings" className="paper-btn">
            Collection settings
          </Link>
          <button
            type="button"
            className="paper-btn paper-btn-solid"
            disabled={active || submitting}
            onClick={() => void collect()}
          >
            {submitting
              ? "Queuing…"
              : active
                ? "Collection in progress"
                : failed.length || latest?.status === "FAILED"
                  ? "Retry collection"
                  : "Run now"}
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--pass-ink)]">
          {error}
        </p>
      ) : null}
      {latest?.error ? (
        <p className="mt-3 text-sm text-[var(--pass-ink)]">{latest.error}</p>
      ) : null}
      {latest && ["EMPTY", "FAILED"].includes(latest.status) ? (
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Your historical Board is preserved. Any recommendations below are from
          an earlier successful import.
        </p>
      ) : null}
      {failed.length > 0 ? (
        <details className="mt-3 text-sm" open>
          <summary className="cursor-pointer font-semibold">
            {failed.length} companies could not be collected
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--ink-soft)]">
            {failed.map((source, index) => (
              <li key={`${source.company}-${index}`}>
                {source.company}:{" "}
                {source.error ?? "Source request failed after retries."}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {runs.length > 1 ? (
        <details className="mt-4 border-t border-[var(--hair)] pt-3 text-sm">
          <summary className="cursor-pointer">Recent collections</summary>
          <ul className="mt-2 space-y-1 text-[var(--ink-soft)]">
            {runs.slice(1).map((run) => (
              <li key={run.id}>
                {time(run.createdAt)} · {run.status.toLowerCase()} ·{" "}
                {
                  sourcesOf(run.report).filter(
                    (source) => source.status === "success",
                  ).length
                }
                /{sourcesOf(run.report).length} sources
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
