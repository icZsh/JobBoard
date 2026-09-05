"use client";

import { useState } from "react";
import { resumeDownloadUrl } from "@/lib/resume/links";

type ResumeItem = {
  id: string;
  originalName: string;
  extractedText: string;
  confirmedText: string | null;
};

export function ResumeManager({
  initial,
  activeId: initialActiveId,
  capabilityReason,
}: {
  initial: ResumeItem[];
  activeId: string | null;
  capabilityReason: string | null;
}) {
  const [resumes, setResumes] = useState(initial);
  const [activeId, setActiveId] = useState(initialActiveId);
  const [selected, setSelected] = useState<ResumeItem | null>(
    initial.find((file) => file.id === initialActiveId) ?? initial[0] ?? null,
  );
  const [text, setText] = useState(
    selected?.confirmedText ?? selected?.extractedText ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function choose(file: ResumeItem) {
    setSelected(file);
    setText(file.confirmedText ?? file.extractedText);
    setError(null);
    setMessage(null);
  }

  async function upload(file: File) {
    setError(null);
    setMessage(null);
    if (file.size > 10 * 1024 * 1024) {
      setError("Resume files must be 10 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/resumes", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.errorMessage || "Upload failed.");
      const item: ResumeItem = {
        id: result.id,
        originalName: result.originalName,
        extractedText: result.extractedText,
        confirmedText: null,
      };
      setResumes((items) => [item, ...items]);
      choose(item);
      setMessage(
        "Upload ready for review. Confirm the text below to make this your active resume.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!selected || !text.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/resumes/${selected.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.errorMessage || "Confirmation failed.");
      const updated = { ...selected, confirmedText: text.trim() };
      setSelected(updated);
      setResumes((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      setActiveId(updated.id);
      setMessage(
        "Resume confirmed. Tailoring will use this text as the source of your experience and qualifications.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Confirmation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="paper-card h-fit">
        <h2 className="paper-label">Upload a resume</h2>
        <p className="my-3 text-sm text-[var(--ink-soft)]">
          PDF, DOCX, Markdown, or text · up to 10 MB. Scanned PDFs need OCR
          before upload.
        </p>
        <label className="grid gap-2">
          <span className="text-sm font-semibold">Choose file</span>
          <input
            type="file"
            accept=".pdf,.docx,.md,.txt"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void upload(file);
              event.currentTarget.value = "";
            }}
            className="paper-input"
          />
        </label>
        <p className="my-4 text-xs text-[var(--ink-soft)]">
          Your current confirmed resume stays active until you confirm a
          replacement. Uploaded originals remain available for download.
        </p>
        <h2 className="paper-label mb-3">Recent resumes</h2>
        <div className="grid gap-2">
          {resumes.map((file) => (
            <button
              type="button"
              disabled={busy}
              key={file.id}
              onClick={() => choose(file)}
              aria-pressed={selected?.id === file.id}
              className={`paper-btn !h-auto !justify-start break-all text-left ${selected?.id === file.id ? "paper-btn-solid" : ""}`}
            >
              {file.originalName}
              {activeId === file.id ? " · Active" : ""}
            </button>
          ))}
        </div>
      </aside>
      <section className="paper-card">
        {capabilityReason?.includes("API key") ? (
          <p className="mb-4 text-sm text-[var(--ink-soft)]">
            {capabilityReason} You can still upload and confirm your resume.
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded border border-[var(--pass-border)] bg-[var(--pass-bg)] p-3 text-sm"
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p
            role="status"
            className="mb-4 rounded border border-[var(--accent-border)] bg-[var(--accent-bg)] p-3 text-sm"
          >
            {message}
          </p>
        ) : null}
        {selected ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Review extracted text</h2>
              <a
                className="paper-btn"
                href={resumeDownloadUrl(selected.id)}
                download
              >
                Download original
              </a>
            </div>
            <p className="mb-3 text-sm text-[var(--ink-soft)]">
              Check names, dates, and formatting. Edit any extraction errors
              before confirming. Only this confirmed text is used for resume
              tailoring.
            </p>
            <label className="grid gap-2">
              <span className="paper-label">{selected.originalName}</span>
              <textarea
                className="paper-textarea min-h-[440px] font-mono text-sm"
                value={text}
                maxLength={200000}
                disabled={busy}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="paper-btn paper-btn-solid mt-4"
              disabled={busy || !text.trim()}
              onClick={() => void confirm()}
            >
              {busy
                ? "Working…"
                : activeId === selected.id
                  ? "Confirm updated text"
                  : "Confirm and use this resume"}
            </button>
          </>
        ) : (
          <p className="text-sm text-[var(--ink-soft)]">
            Upload a resume to preview and confirm its text.
          </p>
        )}
      </section>
    </div>
  );
}
