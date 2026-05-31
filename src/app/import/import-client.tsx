"use client";

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
    <div className="border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
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
      <span className="border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
        Invalid
      </span>
    );
  }

  if (row.duplicateInPayload) {
    return (
      <span className="border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
        Payload Duplicate
      </span>
    );
  }

  if (row.existingJobId) {
    return (
      <span className="border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700">
        Existing
      </span>
    );
  }

  return (
    <span className="border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
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
    <section className="grid gap-4">
      <div className="border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="inline-flex h-10 cursor-pointer items-center justify-center border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-slate-400">
            <input
              accept="application/json,.json"
              className="sr-only"
              onChange={handleFileChange}
              type="file"
            />
            Choose JSON
          </label>
          {fileName ? (
            <p className="text-sm text-slate-600">{fileName}</p>
          ) : null}
        </div>

        <textarea
          className="mt-4 min-h-80 w-full resize-y border border-slate-200 bg-white p-3 font-mono text-sm text-slate-900"
          onChange={(event) => {
            setJsonText(event.target.value);
            setImportResult(null);
            setErrorMessage(null);
          }}
          placeholder='{"run_date":"2026-05-30","source_name":"daily_job_automation","jobs":[]}'
          spellCheck={false}
          value={jsonText}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="h-10 border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!jsonText.trim() || isPreviewing}
            onClick={handlePreview}
            type="button"
          >
            {isPreviewing ? "Previewing" : "Preview"}
          </button>
          <button
            className="h-10 border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
            disabled={!canConfirm}
            onClick={handleConfirm}
            type="button"
          >
            {isImporting ? "Importing" : "Confirm Import"}
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      {importResult &&
      !importResult.ok &&
      "importRunId" in importResult &&
      importResult.importRunId ? (
        <div className="border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
          Failed run saved: {importResult.importRunId}
        </div>
      ) : null}

      {preview ? (
        <div className="grid gap-4">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCell label="Jobs" value={preview.totalJobs} />
            <SummaryCell label="New" value={preview.newJobs} />
            <SummaryCell label="Existing" value={preview.duplicateJobs} />
            <SummaryCell label="Invalid" value={preview.invalidJobs} />
          </section>

          <section className="border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Preview
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {preview.runDate}
                  {preview.sourceName ? ` · ${preview.sourceName}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                <span>{preview.wouldImportJobs} unique</span>
                <span>{preview.inPayloadDuplicates} payload duplicates</span>
              </div>
            </div>

            {preview.validationErrors.length > 0 ? (
              <div className="mt-4 border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <p className="font-semibold">Validation errors</p>
                <ul className="mt-2 grid gap-1">
                  {preview.validationErrors.slice(0, 8).map((error) => (
                    <li key={`${error.path}-${error.message}`}>
                      {error.path}: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="py-2 pr-3 font-semibold">Row</th>
                    <th className="py-2 pr-3 font-semibold">Job</th>
                    <th className="py-2 pr-3 font-semibold">Company</th>
                    <th className="py-2 pr-3 font-semibold">Fit</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 25).map((row) => (
                    <tr
                      className="border-b border-slate-100 last:border-0"
                      key={row.index}
                    >
                      <td className="py-3 pr-3 text-slate-600">{row.index}</td>
                      <td className="max-w-xs py-3 pr-3 font-medium text-slate-900">
                        {row.title ?? "Untitled"}
                        {row.errors.length > 0 ? (
                          <p className="mt-1 text-xs font-normal text-rose-700">
                            {row.errors.join("; ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3 text-slate-700">
                        {row.company ?? "Unknown"}
                      </td>
                      <td className="py-3 pr-3 text-slate-700">
                        {row.fitScore ?? "Not scored"}
                      </td>
                      <td className="py-3 pr-3">
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
