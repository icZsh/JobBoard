import {
  isResumeTailoringError,
  type ResumeTailoringErrorCode,
} from "@/lib/resume/errors";
import { tailorResumeForJob } from "@/lib/resume/tailor-service";
import { requireApiAdmin } from "@/lib/auth/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusByErrorCode: Record<ResumeTailoringErrorCode, number> = {
  JOB_NOT_FOUND: 404,
  RESUME_NOT_CONFIGURED: 400,
  RESUME_NOT_TEXT: 400,
  RESUME_UNREADABLE: 400,
  NO_JOB_CONTEXT: 400,
  GEMINI_UNAVAILABLE: 502,
  GEMINI_INVALID_JSON: 502,
  OUTPUT_WRITE_FAILED: 500,
  TRACKING_UPDATE_FAILED: 500,
};

function chooseResumeTailoringStatus(error: unknown) {
  return isResumeTailoringError(error) ? statusByErrorCode[error.code] : 500;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireApiAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;

  try {
    const result = await tailorResumeForJob(id);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Resume tailoring failed.";

    return Response.json(
      { ok: false, errorMessage },
      { status: chooseResumeTailoringStatus(error) },
    );
  }
}
