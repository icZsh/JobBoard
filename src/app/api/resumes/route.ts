import { requireApiAdmin } from "@/lib/auth/authorization";
import { createUploadedResume } from "@/lib/resume/files";
import {
  MAX_RESUME_BYTES,
  ResumeUploadError,
  readLimitedRequestBody,
} from "@/lib/resume/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await requireApiAdmin(request);
  if (denied) return denied;
  if (
    Number(request.headers.get("content-length")) >
    MAX_RESUME_BYTES + 64 * 1024
  )
    return Response.json(
      { ok: false, errorMessage: "Resume files must be 10 MB or smaller." },
      { status: 413 },
    );
  try {
    // Bound the multipart body even when Content-Length is absent or incorrect.
    const bytes = await readLimitedRequestBody(
      request,
      MAX_RESUME_BYTES + 64 * 1024,
    );
    const form = await new Response(bytes, {
      headers: { "content-type": request.headers.get("content-type") || "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ResumeUploadError("Choose a resume file to upload.");
    const resume = await createUploadedResume(
      file.name,
      Buffer.from(await file.arrayBuffer()),
    );
    return Response.json(
      {
        ok: true,
        id: resume.id,
        originalName: resume.originalName,
        extractedText: resume.extractedText,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        errorMessage:
          error instanceof ResumeUploadError
            ? error.message
            : "The resume could not be uploaded. Check the file and try again.",
      },
      { status: error instanceof ResumeUploadError ? error.status : 400 },
    );
  }
}
