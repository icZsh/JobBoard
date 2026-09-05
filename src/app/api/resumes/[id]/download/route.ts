import { requireApiAdmin } from "@/lib/auth/authorization";
import { prisma } from "@/lib/prisma";
import { readResumeBytes } from "@/lib/resume/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireApiAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!/^[a-z0-9_-]{1,80}$/i.test(id))
    return Response.json({ ok: false }, { status: 404 });
  const resume = await prisma.resumeFile.findUnique({ where: { id } });
  if (!resume) return Response.json({ ok: false }, { status: 404 });
  try {
    const bytes = await readResumeBytes(resume.storageKey);
    const fallback =
      resume.originalName.replace(/[^a-zA-Z0-9._-]/g, "_") || "resume";
    return new Response(bytes, {
      headers: {
        "content-type": resume.mimeType,
        "content-disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(resume.originalName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        "content-length": String(bytes.length),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { ok: false, errorMessage: "Resume file unavailable." },
      { status: 404 },
    );
  }
}
