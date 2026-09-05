import Link from "next/link";
import { requireAdmin } from "@/lib/auth/authorization";
import { prisma } from "@/lib/prisma";
import { getActiveResume, getResumeCapability } from "@/lib/resume/files";
import { ResumeManager } from "./resume-manager";

export const dynamic = "force-dynamic";

export default async function ResumeSettingsPage() {
  await requireAdmin("/settings/resume");
  const [active, recent, capability] = await Promise.all([
    getActiveResume(),
    prisma.resumeFile.findMany({
      where: { kind: "ORIGINAL" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    getResumeCapability(),
  ]);
  const resumes =
    active && !recent.some((file) => file.id === active.id)
      ? [active, ...recent]
      : recent;
  return (
    <main className="paper-app">
      <div className="paper-wrap">
        <header className="paper-head">
          <div>
            <p className="paper-eyebrow">Your profile</p>
            <h1 className="paper-title">Resume</h1>
            <p className="paper-sub">
              Upload, review the extracted text, and confirm the resume used for
              tailoring.
            </p>
          </div>
          <Link className="paper-btn" href="/settings">
            Settings
          </Link>
        </header>
        <ResumeManager
          activeId={active?.id ?? null}
          capabilityReason={capability.reason}
          initial={resumes.map((file) => ({
            id: file.id,
            originalName: file.originalName,
            extractedText: file.extractedText ?? "",
            confirmedText: file.confirmedText,
          }))}
        />
      </div>
    </main>
  );
}
