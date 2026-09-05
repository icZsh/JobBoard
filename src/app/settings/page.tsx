import Link from "next/link";
import { requireAdmin } from "@/lib/auth/authorization";
import {
  defaultSelfHostConfig,
  getCollectionConfig,
} from "@/lib/selfhost/config";
import { ConfigForm, AccountActions } from "./config-form";
export const dynamic = "force-dynamic";
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const user = await requireAdmin("/settings");
  const config = (await getCollectionConfig()) ?? defaultSelfHostConfig();
  const { setup } = await searchParams;
  return (
    <main className="paper-app">
      <div className="paper-wrap">
        <header className="paper-head">
          <div>
            <p className="paper-eyebrow">Your search</p>
            <h1 className="paper-title">Settings</h1>
            <p className="paper-sub">
              {user.email} · Preferences apply to your next collection
            </p>
          </div>
          <nav className="paper-actions">
            <Link className="paper-btn" href="/today">
              Today
            </Link>
            <Link className="paper-btn" href="/board">
              Board
            </Link>
            <Link className="paper-btn" href="/settings/resume">
              Resume
            </Link>
          </nav>
        </header>
        {setup === "1" && (
          <section className="paper-card mb-5">
            <h2 className="text-xl font-bold">Your JobBoard is ready</h2>
            <p className="my-3 text-sm">
              You can start collecting now. Optionally{" "}
              <Link className="underline" href="/settings/resume">
                upload and confirm your resume
              </Link>{" "}
              for resume tailoring.
            </p>
          </section>
        )}
        <section className="paper-card mb-5">
          <AccountActions />
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <Link href="/settings/resume" className="underline">
              Manage resume
            </Link>
            <Link href="/import" className="underline">
              Import jobs
            </Link>
            <a href="/api/export" className="underline">
              Export job data
            </a>
          </div>
        </section>
        <ConfigForm initial={config} />
      </div>
    </main>
  );
}
