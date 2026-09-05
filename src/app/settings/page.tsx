import Link from "next/link";
import type { CSSProperties } from "react";
import {
  CalendarCheck,
  Columns3,
  Database,
  Download,
  FileText,
  Gauge,
  Save,
  Settings,
  Upload,
} from "lucide-react";
import { getSettingsValues } from "@/lib/settings";
import { saveSettings } from "./actions";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams: Promise<{
    saved?: string | string[];
    error?: string | string[];
  }>;
};

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const settings = await getSettingsValues();
  const saved = getSingleParam(params.saved) === "1";
  const error = getSingleParam(params.error);
  const resumePath = settings.resumeFilePath.trim();

  return (
    <main className="paper-app">
      <div className="paper-wrap">
        <header className="paper-head">
          <div>
            <p className="paper-eyebrow">Preferences</p>
            <h1 className="paper-title">Settings</h1>
            <p className="paper-sub">
              Resume path stored locally ·{" "}
              <strong>{settings.highFitThreshold}+ high fit</strong>
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
            <Link className="paper-btn" href="/import">
              <Upload className="h-4 w-4" aria-hidden="true" />
              Import
            </Link>
          </div>
        </header>

        {saved ? (
          <div className="mb-5 rounded-[var(--radius-ctl)] border border-[var(--accent-border)] bg-[var(--accent-bg)] px-4 py-3 text-sm font-semibold text-[var(--accent-ink)]">
            Settings saved.
          </div>
        ) : null}

        {error === "high-fit-threshold" ? (
          <div className="mb-5 rounded-[var(--radius-ctl)] border border-[var(--pass-border)] bg-[var(--pass-bg)] px-4 py-3 text-sm font-semibold text-[var(--pass-ink)]">
            High-fit threshold must be a whole number from 1 to 100.
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
          <section className="paper-card">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-ctl)] border border-[var(--hair)] bg-[var(--surface-2)] text-[var(--accent-ink)]">
                <Settings className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <div>
                <p className="paper-label">Local Defaults</p>
                <h2 className="mt-1 text-xl font-bold text-[var(--ink)]">
                  Job Matching Preferences
                </h2>
              </div>
            </div>

            <form action={saveSettings} className="mt-7 grid gap-6">
              <label className="grid gap-2">
                <span className="paper-label">Resume File Path</span>
                <div className="flex items-center gap-3">
                  <FileText
                    className="hidden h-5 w-5 shrink-0 text-[var(--ink-faint)] sm:block"
                    aria-hidden="true"
                  />
                  <input
                    className="paper-input font-mono text-[12.5px]"
                    defaultValue={settings.resumeFilePath}
                    name="resumeFilePath"
                    placeholder="/Users/isaaczhu/path/to/resume.pdf"
                  />
                </div>
              </label>

              <label className="grid max-w-xs gap-2">
                <span className="paper-label">High-Fit Threshold</span>
                <div className="flex items-center gap-3">
                  <Gauge
                    className="hidden h-5 w-5 shrink-0 text-[var(--ink-faint)] sm:block"
                    aria-hidden="true"
                  />
                  <input
                    className="paper-input font-mono"
                    defaultValue={settings.highFitThreshold}
                    max={100}
                    min={1}
                    name="highFitThreshold"
                    required
                    type="number"
                  />
                </div>
              </label>

              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--hair)] pt-6">
                <button className="paper-btn paper-btn-solid" type="submit">
                  <Save className="h-4 w-4" aria-hidden="true" />
                  Save Settings
                </button>
                <Link className="paper-btn paper-btn-ghost" href="/today">
                  Open Today
                </Link>
              </div>
            </form>
          </section>

          <aside className="grid h-fit gap-5">
            <section className="paper-card">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-ctl)] border border-[var(--hair)] bg-[var(--surface-2)] text-[var(--accent-ink)]">
                  <FileText className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <div>
                  <p className="paper-label">Current Profile</p>
                  <h2 className="mt-1 text-lg font-bold text-[var(--ink)]">
                    Resume Context
                  </h2>
                </div>
              </div>

              <div className="mt-5 divide-y divide-[var(--hair)] border-y border-[var(--hair)]">
                <div className="py-4">
                  <p className="paper-label">Resume Path</p>
                  <p
                    className={`mt-2 break-words font-mono text-[12.5px] leading-6 ${
                      resumePath ? "text-[var(--ink)]" : "text-[var(--ink-faint)]"
                    }`}
                  >
                    {resumePath || "Not set"}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <p className="paper-label">High Fit Starts At</p>
                    <p className="mt-2 font-mono text-sm font-semibold text-[var(--ink)]">
                      {settings.highFitThreshold}/100
                    </p>
                  </div>
                  <div
                    className="fit-ring"
                    style={
                      { "--score": settings.highFitThreshold } as CSSProperties
                    }
                  >
                    <span>{settings.highFitThreshold}</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="paper-card">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-ctl)] border border-[var(--hair)] bg-[var(--surface-2)] text-[var(--accent-ink)]">
                  <Database className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <div>
                  <p className="paper-label">Data</p>
                  <h2 className="mt-1 text-lg font-bold text-[var(--ink)]">
                    Local Snapshot
                  </h2>
                </div>
              </div>

              <div className="mt-5 border-t border-[var(--hair)] pt-5">
                <a className="paper-btn w-full" download href="/api/export">
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Export JSON
                </a>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
