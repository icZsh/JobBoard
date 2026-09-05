import { redirect } from "next/navigation";
import { hasAdminSession, isSetupOpen } from "@/lib/auth/authorization";
import { defaultSelfHostConfig } from "@/lib/selfhost/config";
import { ConfigForm } from "../settings/config-form";
export const dynamic = "force-dynamic";
export default async function SetupPage() {
  if (!(await isSetupOpen()))
    redirect((await hasAdminSession()) ? "/settings" : "/login");
  return (
    <main className="paper-app">
      <div className="paper-wrap">
        <header className="paper-head">
          <div>
            <p className="paper-eyebrow">Welcome to your JobBoard</p>
            <h1 className="paper-title">Set up your search</h1>
            <p className="paper-sub">
              Create your account and choose what to collect. Adding a resume is
              optional and comes next.
            </p>
          </div>
        </header>
        <ConfigForm initial={defaultSelfHostConfig()} setup />
      </div>
    </main>
  );
}
