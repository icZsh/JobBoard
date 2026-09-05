import { requireApiAdmin } from "@/lib/auth/authorization";
import { confirmResume } from "@/lib/resume/files";
import {
  ResumeUploadError,
  MAX_RESUME_TEXT_CHARS,
  readLimitedRequestBody,
} from "@/lib/resume/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireApiAdmin(request);
  if (denied) return denied;
  try {
    const payload: unknown = JSON.parse(
      (
        await readLimitedRequestBody(request, MAX_RESUME_TEXT_CHARS * 6 + 1000)
      ).toString("utf8"),
    );
    const text =
      payload && typeof payload === "object" && "text" in payload
        ? payload.text
        : undefined;
    const resume = await confirmResume((await context.params).id, text);
    return Response.json(
      { ok: true, id: resume.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        errorMessage:
          error instanceof ResumeUploadError
            ? error.message
            : "Resume confirmation failed.",
      },
      { status: error instanceof ResumeUploadError ? error.status : 400 },
    );
  }
}
