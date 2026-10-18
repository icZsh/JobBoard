"use client";

import { AlertTriangle, ArrowRight, CalendarCheck, Check, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatStatusLabel, getLocalDateKey } from "@/lib/format";
import { canTailorResumeForStatus } from "@/lib/jobs/resume-tailoring";
import {
  buildTrackingPatch,
  mergeSavedTracking,
  patchJobTracking,
  toTrackingFormState,
  type TrackingFormState,
} from "@/lib/jobs/tracking-client";

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

function useUnsavedChangesWarning(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Older Chromium only prompts when returnValue is set.
      event.returnValue = true;
    }

    // In-app links (e.g. Back to Board) navigate client-side without beforeunload.
    function confirmLeavingLink(event: MouseEvent) {
      const link =
        event.target instanceof Element ? event.target.closest("a[href]") : null;

      if (
        !link ||
        link.getAttribute("target") === "_blank" ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      if (!window.confirm("You have unsaved tracking changes. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    window.addEventListener("click", confirmLeavingLink, true);

    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      window.removeEventListener("click", confirmLeavingLink, true);
    };
  }, [enabled]);
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [tailorWarnings, setTailorWarnings] = useState<string[]>([]);
  const [tailorChanges, setTailorChanges] = useState<string[]>([]);
  const dirty = useMemo(() => !isEqual(form, lastSaved), [form, lastSaved]);
  const showAppliedQuick = !terminalAppliedStatuses.has(form.status);
  const canTailorResume = canTailorResumeForStatus(form.status);

  useUnsavedChangesWarning(dirty);

  function update<K extends keyof TrackingFormState>(
    key: K,
    value: TrackingFormState[K],
  ) {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(submitted: TrackingFormState) {
    const patch = buildTrackingPatch(submitted, lastSaved);

    if (Object.keys(patch).length === 0 || saving) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const savedState = toTrackingFormState(
        await patchJobTracking(jobId, patch),
      );

      setLastSaved(savedState);
      setForm((current) => mergeSavedTracking(current, submitted, savedState));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2600);
    } catch (error) {
      setSaveError(
        `Couldn't save tracking. ${
          error instanceof Error ? error.message : "Unknown error."
        }`,
      );
    } finally {
      setSaving(false);
    }
  }

  function markAppliedToday() {
    const submitted = {
      ...form,
      status: "APPLIED",
      appliedAt: form.appliedAt || getLocalDateKey(new Date()),
    };

    setSaved(false);
    setForm(submitted);
    void save(submitted);
  }

  async function tailorResume() {
    if (!canTailorResume || tailoring) {
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
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-ctl)] border border-dashed border-[var(--accent-border)] bg-[var(--accent-bg)] text-xs font-bold text-[var(--accent-ink)] hover:border-solid disabled:cursor-not-allowed disabled:opacity-55"
            disabled={saving}
            onClick={markAppliedToday}
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
                  Uses the configured Markdown resume and this job&apos;s recommendation context.
                </p>
              </div>
              <Sparkles className="mt-0.5 h-4 w-4 flex-none text-[var(--accent-ink)]" />
            </div>

            <button
              className="paper-btn paper-btn-solid mt-3 w-full"
              disabled={tailoring}
              onClick={() => void tailorResume()}
              type="button"
            >
              <Sparkles className="h-4 w-4" />
              {tailoring ? "Generating" : "Tailor resume"}
            </button>

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
                <p className="mt-1 break-all font-mono text-[10.5px] leading-5 text-[var(--ink-soft)]">
                  {form.resumePath}
                </p>
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
            onClick={() => void save(form)}
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

        {saveError ? (
          <div
            className="flex gap-2 rounded-[10px] border border-[var(--pass-border)] bg-[var(--pass-bg)] p-3 text-xs leading-5 text-[var(--pass-ink)]"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <span>{saveError}</span>
          </div>
        ) : null}

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
