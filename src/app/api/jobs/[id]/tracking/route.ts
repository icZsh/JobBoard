import { trackingPatchSchema } from "@/lib/jobs/tracking-validation";
import { updateJobTracking } from "@/lib/jobs/tracking";
import { requireApiAdmin } from "@/lib/auth/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatValidationError(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "payload";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireApiAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { ok: false, errorMessage: "Malformed JSON request body." },
      { status: 400 },
    );
  }

  const parsed = trackingPatchSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { ok: false, errorMessage: formatValidationError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const changes = { ...parsed.data };
    // Resume associations are written only by the managed resume service.
    delete changes.resumePath;
    delete changes.resumeVersion;
    const tracking = await updateJobTracking(id, changes);
    return Response.json({ ok: true, tracking });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Tracking update failed.";
    const status = errorMessage.includes("not found") ? 404 : 500;

    return Response.json({ ok: false, errorMessage }, { status });
  }
}
