"use client";

import { AlertTriangle, ArrowRight, CalendarCheck, Check, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { formatStatusLabel } from "@/lib/format";
import { canTailorResumeForStatus } from "@/lib/jobs/resume-tailoring";
import Link from "next/link";
import { isResumeDownloadUrl } from "@/lib/resume/links";

type TrackingFormState = {
  status: string;
  notes: string;
  nextAction: string;
  nextActionDate: string;
  appliedAt: string;
  resumePath: string;
  resumeVersion: string;
};

type StatusOption = {
  value: string;
  hue: string;
};

const terminalAppliedStatuses = new Set([
  "APPLIED",
  "INTERVIEWING",
  "OFFER",
  "REJECTED",
]);

type TailorResumeSuccess = {
  ok: true;
  resumePath: string;
  resumeVersion: string;
  warnings?: string[];
  changes?: string[];
};

type TailorResumeFailure = {
  ok: false;
  errorMessage?: string;
};

type TailorResumeResponse = TailorResumeSuccess | TailorResumeFailure;

function isEqual(left: TrackingFormState, right: TrackingFormState) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function TrackingForm({
  jobId,
  sourceUrl,
  statusOptions,
  initial,
  resumeCapability,
}: {
  jobId: string;
  sourceUrl: string | null;
  statusOptions: StatusOption[];
  initial: TrackingFormState;
  resumeCapability: { enabled: boolean; reason: string | null };
}) {
  const [form, setForm] = useState(initial);
  const [lastSaved, setLastSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [tailorWarnings, setTailorWarnings] = useState<string[]>([]);
  const [tailorChanges, setTailorChanges] = useState<string[]>([]);
  const dirty = useMemo(() => !isEqual(form, lastSaved), [form, lastSaved]);
  const showAppliedQuick = !terminalAppliedStatuses.has(form.status);
  const canTailorResume = canTailorResumeForStatus(form.status);

  function update<K extends keyof TrackingFormState>(
    key: K,
    value: TrackingFormState[K],
  ) {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!dirty || saving) {
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`/api/jobs/${jobId}/tracking`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: form.status,
          notes: form.notes,
          nextAction: form.nextAction,
          nextActionDate: form.nextActionDate || null,
          appliedAt: form.appliedAt || null,
        }),
      });

      if (!response.ok) {
        throw new Error("Save failed.");
      }

      setLastSaved(form);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2600);
    } finally {
      setSaving(false);
    }
  }

  async function tailorResume() {
    if (!canTailorResume || !resumeCapability.enabled || tailoring) {
      return;
    }

    setTailoring(true);
    setTailorError(null);
    setTailorWarnings([]);
    setTailorChanges([]);

    try {
      const response = await fetch(`/api/jobs/${jobId}/tailor-resume`, {
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

      const resumeFields = {
        resumePath: data.resumePath,
        resumeVersion: data.resumeVersion,
      };

      setForm((current) => ({ ...current, ...resumeFields }));
      setLastSaved((current) => ({ ...current, ...resumeFields }));
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
    <aside className="sticky top-6 h-fit rounded-[var(--radius-card)] border border-[var(--hair)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]">
      <h2 className="paper-label">Tracking</h2>
      <div className="mt-5 flex flex-col gap-4">
        <label className="grid gap-1.5">
          <span className="text-xs font-bold text-[var(--ink)]">Status</span>
          <select
            className="paper-select"
            onChange={(event) => update("status", event.target.value)}
            value={form.status}
          >
            {statusOptions.map((status) => (
              <option key={status.value} value={status.value}>
                {formatStatusLabel(status.value)}
              </option>
            ))}
          </select>
        </label>

        {showAppliedQuick ? (
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-ctl)] border border-dashed border-[var(--accent-border)] bg-[var(--accent-bg)] text-xs font-bold text-[var(--accent-ink)] hover:border-solid"
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10);
              setSaved(false);
              setForm((current) => ({
                ...current,
                status: "APPLIED",
                appliedAt: current.appliedAt || today,
              }));
            }}
            type="button"
          >
            <CalendarCheck className="h-4 w-4" />
            Mark as applied today
          </button>
        ) : null}

        <label className="grid gap-1.5">
          <span className="text-xs font-bold text-[var(--ink)]">Notes</span>
          <textarea
            className="paper-textarea"
            onChange={(event) => update("notes", event.target.value)}
            value={form.notes}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-bold text-[var(--ink)]">Next action</span>
          <input
            className="paper-input"
            onChange={(event) => update("nextAction", event.target.value)}
            value={form.nextAction}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-[var(--ink)]">
              Next action date
            </span>
            <input
              className="paper-input"
              onChange={(event) => update("nextActionDate", event.target.value)}
              type="date"
              value={form.nextActionDate}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-[var(--ink)]">
              Applied date
            </span>
            <input
              className="paper-input"
              onChange={(event) => update("appliedAt", event.target.value)}
              type="date"
              value={form.appliedAt}
            />
          </label>
        </div>

        {canTailorResume ? (
          <div className="rounded-[var(--radius-ctl)] border border-[var(--hair)] bg-[var(--surface-2)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="paper-label text-[var(--accent-ink)]">
                  Resume tailoring
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                  Uses your confirmed resume and this job&apos;s description.
                </p>
              </div>
              <Sparkles className="mt-0.5 h-4 w-4 flex-none text-[var(--accent-ink)]" />
            </div>

            <button
              className="paper-btn paper-btn-solid mt-3 w-full"
              disabled={tailoring || !resumeCapability.enabled}
              onClick={() => void tailorResume()}
              type="button"
            >
              <Sparkles className="h-4 w-4" />
              {tailoring ? "Generating" : "Tailor resume"}
            </button>

            {!resumeCapability.enabled ? <p className="mt-2 text-xs text-[var(--ink-soft)]">{resumeCapability.reason} <Link className="underline" href="/settings/resume">Manage resume</Link></p> : null}

            {tailoring ? (
              <p className="mt-2 text-xs text-[var(--ink-soft)]">
                Gemini is tailoring a Markdown resume. This may take a moment.
              </p>
            ) : null}

            {tailorError ? (
              <div className="mt-3 flex gap-2 rounded-[10px] border border-[var(--pass-border)] bg-[var(--pass-bg)] p-3 text-xs leading-5 text-[var(--pass-ink)]">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{tailorError}</span>
              </div>
            ) : null}

            {form.resumePath && !tailorError ? (
              <div className="mt-3 rounded-[10px] border border-[var(--accent-border)] bg-[var(--accent-bg)] p-3">
                <p className="text-xs font-bold text-[var(--accent-ink)]">
                  Resume saved
                </p>
                <p className="mt-1 break-all font-mono text-[10.5px] leading-5 text-[var(--accent-ink)]">
                  {form.resumeVersion || "Tailored resume"}
                </p>
                {isResumeDownloadUrl(form.resumePath) ? <a className="paper-btn mt-2" href={form.resumePath} download>Download tailored resume</a> : <p className="mt-2 text-xs">A legacy resume reference is saved. Generate a new resume to download it here.</p>}
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

        {form.resumePath && isResumeDownloadUrl(form.resumePath) && !canTailorResume ? <a className="paper-btn" href={form.resumePath} download>Download saved resume</a> : null}

        <div className="mt-1 flex items-center gap-3">
          <button
            className="paper-btn paper-btn-solid flex-1"
            disabled={!dirty || saving}
            onClick={() => void save()}
            type="button"
          >
            {dirty ? (saving ? "Saving" : "Save tracking") : "Saved"}
          </button>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-bold text-[var(--accent-ink)] transition ${
              saved ? "opacity-100" : "opacity-0"
            }`}
          >
            <Check className="h-4 w-4" />
            Saved
          </span>
        </div>

        {sourceUrl ? (
          <a
            className="paper-btn justify-center"
            href={sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open listing
            <ArrowRight className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </aside>
  );
}
