import { redirect } from "next/navigation";
import { hasAdminSession, isSetupOpen } from "@/lib/auth/authorization";
import { getSafeLoginDestination } from "@/lib/auth/navigation";
import { LoginForm } from "./login-form";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (await isSetupOpen()) redirect("/setup");
  const { next } = await searchParams;
  const destination = getSafeLoginDestination(
    Array.isArray(next) ? next[0] : next,
  );
  if (await hasAdminSession()) redirect(destination);
  return (
    <main className="paper-app">
      <div className="paper-wrap max-w-lg">
        <header className="paper-head">
          <div>
            <p className="paper-eyebrow">Your private JobBoard</p>
            <h1 className="paper-title">Sign in</h1>
            <p className="paper-sub">
              Administrator access · sessions expire after 7 days
            </p>
          </div>
        </header>
        <LoginForm next={destination} />
      </div>
    </main>
  );
}
