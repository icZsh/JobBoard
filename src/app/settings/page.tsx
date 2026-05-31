import Link from "next/link";
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              Preferences
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Settings
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              href="/today"
            >
              Today
            </Link>
            <Link
              className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              href="/board"
            >
              Board
            </Link>
            <Link
              className="border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              href="/import"
            >
              Import
            </Link>
            <a
              className="border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              download
              href="/api/export"
            >
              Export JSON
            </a>
          </div>
        </header>

        {saved ? (
          <div className="border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
            Settings saved.
          </div>
        ) : null}

        {error === "high-fit-threshold" ? (
          <div className="border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
            High-fit threshold must be a whole number from 1 to 100.
          </div>
        ) : null}

        <section className="border border-slate-200 bg-white p-5 shadow-sm">
          <form action={saveSettings} className="grid gap-5">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Resume File Path</span>
              <input
                className="h-10 border border-slate-200 bg-white px-3 text-sm text-slate-900"
                defaultValue={settings.resumeFilePath}
                name="resumeFilePath"
              />
            </label>

            <label className="grid max-w-xs gap-1 text-sm">
              <span className="font-medium text-slate-700">
                High-Fit Threshold
              </span>
              <input
                className="h-10 border border-slate-200 bg-white px-3 text-sm text-slate-900"
                defaultValue={settings.highFitThreshold}
                max={100}
                min={1}
                name="highFitThreshold"
                required
                type="number"
              />
            </label>

            <div>
              <button
                className="h-10 border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
                type="submit"
              >
                Save Settings
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
