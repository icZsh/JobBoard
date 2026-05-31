"use client";

import { ArrowRight, Check, CalendarCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { formatStatusLabel } from "@/lib/format";

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

function isEqual(left: TrackingFormState, right: TrackingFormState) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function TrackingForm({
  jobId,
  sourceUrl,
  statusOptions,
  initial,
}: {
  jobId: string;
  sourceUrl: string | null;
  statusOptions: StatusOption[];
  initial: TrackingFormState;
}) {
  const [form, setForm] = useState(initial);
  const [lastSaved, setLastSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = useMemo(() => !isEqual(form, lastSaved), [form, lastSaved]);
  const showAppliedQuick = !terminalAppliedStatuses.has(form.status);

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
          resumePath: form.resumePath,
          resumeVersion: form.resumeVersion,
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

        <label className="grid gap-1.5">
          <span className="text-xs font-bold text-[var(--ink)]">Resume path</span>
          <input
            className="paper-input"
            onChange={(event) => update("resumePath", event.target.value)}
            value={form.resumePath}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-bold text-[var(--ink)]">
            Resume version
          </span>
          <input
            className="paper-input"
            onChange={(event) => update("resumeVersion", event.target.value)}
            value={form.resumeVersion}
          />
        </label>

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
