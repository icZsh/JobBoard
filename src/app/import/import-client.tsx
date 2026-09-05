"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Eye,
  FileInput,
  FileJson,
  Upload,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import type {
  ImportJobsResult,
  ImportPreviewResult,
} from "@/lib/import/import-service";

type ApiError = {
  ok: false;
  errorMessage: string;
};

type PreviewResponse = ImportPreviewResult | ApiError;
type ImportResponse = ImportJobsResult | ApiError;

function parseJson(text: string) {
  try {
    return { payload: JSON.parse(text) as unknown, errorMessage: null };
  } catch {
    return { payload: null, errorMessage: "Malformed JSON request body." };
  }
}

function SummaryCell({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="paper-card p-5">
      <p className="paper-label">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold text-[var(--ink)]">
        {value}
      </p>
    </div>
  );
}

function RowStatus({
  row,
}: {
  row: ImportPreviewResult["rows"][number];
}) {
  if (row.errors.length > 0) {
    return (
      <span className="paper-badge badge-pass">
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Invalid
      </span>
    );
  }

  if (row.duplicateInPayload) {
    return (
      <span className="paper-badge badge-high">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Payload Duplicate
      </span>
    );
  }

  if (row.existingJobId) {
    return (
      <span className="paper-badge badge-fit">
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Existing
      </span>
    );
  }

  return (
    <span className="paper-badge badge-apply">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      New
    </span>
  );
}

export function ImportClient() {
  const router = useRouter();
  const [jsonText, setJsonText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [previewSource, setPreviewSource] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const canConfirm =
    Boolean(preview?.canImport) && previewSource === jsonText && !isImporting;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setFileName(file.name);
    setJsonText(await file.text());
    setPreview(null);
    setPreviewSource("");
    setErrorMessage(null);
    setImportResult(null);
  }

  async function handlePreview() {
    setErrorMessage(null);
    setImportResult(null);
    setPreview(null);
    setPreviewSource("");

    const parsed = parseJson(jsonText);

    if (parsed.errorMessage) {
      setErrorMessage(parsed.errorMessage);
      return;
    }

    setIsPreviewing(true);

    try {
      const response = await fetch("/api/import-jobs/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.payload),
      });
      const data = (await response.json()) as PreviewResponse;

      if (!response.ok) {
        setErrorMessage(
          "errorMessage" in data ? data.errorMessage : "Import preview failed.",
        );
        return;
      }

      if (!data.ok) {
        setErrorMessage(data.errorMessage);
        return;
      }

      setPreview(data);
      setPreviewSource(jsonText);
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleConfirm() {
    if (!canConfirm) {
      return;
    }

    const parsed = parseJson(jsonText);

    if (parsed.errorMessage) {
      setErrorMessage(parsed.errorMessage);
      return;
    }

    setErrorMessage(null);
    setImportResult(null);
    setIsImporting(true);

    try {
      const response = await fetch("/api/import-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.payload),
      });
      const data = (await response.json()) as ImportResponse;

      if (response.ok && data.ok) {
        router.push("/today");
        router.refresh();
        return;
      }

      setImportResult(data);
      setErrorMessage(
        "errorMessage" in data ? data.errorMessage : "Import failed.",
      );
      router.refresh();
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="grid gap-5">
      <div className="paper-card">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-ctl)] border border-[var(--hair)] bg-[var(--surface-2)] text-[var(--accent-ink)]">
              <FileJson className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div>
              <p className="paper-label">Payload</p>
              <h2 className="mt-1 text-xl font-bold text-[var(--ink)]">
                Daily Job JSON
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {fileName ? (
              <span className="paper-badge badge-neutral">
                <FileInput className="h-3.5 w-3.5" aria-hidden="true" />
                {fileName}
              </span>
            ) : null}
            <label className="paper-btn cursor-pointer">
              <input
                accept="application/json,.json"
                className="sr-only"
                onChange={handleFileChange}
                type="file"
              />
              <Upload className="h-4 w-4" aria-hidden="true" />
              Choose JSON
            </label>
          </div>
        </div>

        <textarea
          className="paper-textarea paper-json-textarea mt-6 font-mono text-[12.5px]"
          onChange={(event) => {
            setJsonText(event.target.value);
            setImportResult(null);
            setErrorMessage(null);
          }}
          placeholder='{"run_date":"2026-05-30","source_name":"daily_job_automation","jobs":[]}'
          spellCheck={false}
          value={jsonText}
        />

        <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--hair)] pt-5">
          <button
            className="paper-btn"
            disabled={!jsonText.trim() || isPreviewing}
            onClick={handlePreview}
            type="button"
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {isPreviewing ? "Previewing" : "Preview"}
          </button>
          <button
            className="paper-btn paper-btn-solid"
            disabled={!canConfirm}
            onClick={handleConfirm}
            type="button"
          >
            {isImporting ? "Importing" : "Confirm Import"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-[var(--radius-ctl)] border border-[var(--pass-border)] bg-[var(--pass-bg)] px-4 py-3 text-sm font-semibold text-[var(--pass-ink)]">
          {errorMessage}
        </div>
      ) : null}

      {importResult &&
      !importResult.ok &&
      "importRunId" in importResult &&
      importResult.importRunId ? (
        <div className="rounded-[var(--radius-ctl)] border border-[var(--high-border)] bg-[var(--high-bg)] px-4 py-3 text-sm font-semibold text-[var(--high-ink)]">
          Failed run saved: {importResult.importRunId}
        </div>
      ) : null}

      {preview ? (
        <div className="grid gap-5">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCell label="Jobs" value={preview.totalJobs} />
            <SummaryCell label="New" value={preview.newJobs} />
            <SummaryCell label="Existing" value={preview.duplicateJobs} />
            <SummaryCell label="Invalid" value={preview.invalidJobs} />
          </section>

          <section className="paper-card">
            <div className="flex flex-col gap-3 border-b border-[var(--hair)] pb-5 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="paper-label">Preview</p>
                <h2 className="mt-1 text-xl font-bold text-[var(--ink)]">
                  {preview.runDate}
                </h2>
                {preview.sourceName ? (
                  <p className="mt-2 font-mono text-xs text-[var(--ink-faint)]">
                    {preview.sourceName}
                  </p>
                ) : null}
              </div>
              <div className="paper-row">
                <span className="paper-badge badge-neutral">
                  {preview.wouldImportJobs} unique
                </span>
                <span className="paper-badge badge-high">
                  {preview.inPayloadDuplicates} payload duplicates
                </span>
              </div>
            </div>

            {preview.validationErrors.length > 0 ? (
              <div className="mt-5 rounded-[var(--radius-ctl)] border border-[var(--pass-border)] bg-[var(--pass-bg)] p-4 text-sm text-[var(--pass-ink)]">
                <p className="font-bold">Validation errors</p>
                <ul className="mt-2 grid gap-1">
                  {preview.validationErrors.slice(0, 8).map((error) => (
                    <li key={`${error.path}-${error.message}`}>
                      {error.path}: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--hair)]">
                    <th className="paper-label py-3 pr-3">Row</th>
                    <th className="paper-label py-3 pr-3">Job</th>
                    <th className="paper-label py-3 pr-3">Company</th>
                    <th className="paper-label py-3 pr-3">Fit</th>
                    <th className="paper-label py-3 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 25).map((row) => (
                    <tr
                      className="border-b border-[var(--hair)] last:border-0"
                      key={row.index}
                    >
                      <td className="py-4 pr-3 font-mono text-xs text-[var(--ink-faint)]">
                        {row.index}
                      </td>
                      <td className="max-w-xs py-4 pr-3 font-semibold text-[var(--ink)]">
                        {row.title ?? "Untitled"}
                        {row.errors.length > 0 ? (
                          <p className="mt-1 text-xs font-normal leading-5 text-[var(--pass-ink)]">
                            {row.errors.join("; ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-4 pr-3 text-[var(--ink-soft)]">
                        {row.company ?? "Unknown"}
                      </td>
                      <td className="py-4 pr-3 font-mono text-xs text-[var(--ink-soft)]">
                        {row.fitScore ?? "Not scored"}
                      </td>
                      <td className="py-4 pr-3">
                        <RowStatus row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
