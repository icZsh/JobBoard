import { requireApiAdmin } from "@/lib/auth/authorization";
import { enqueueManualRun, getRecentCollectionRuns } from "@/lib/selfhost/runs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = await requireApiAdmin(request);
  if (denied) return denied;
  return Response.json(
    { runs: await getRecentCollectionRuns() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const denied = await requireApiAdmin(request);
  if (denied) return denied;
  try {
    const run = await enqueueManualRun();
    return Response.json(
      { ok: true, run: { id: run.id, status: run.status } },
      { status: 202 },
    );
  } catch (error) {
    return Response.json(
      {
        errorMessage:
          error instanceof Error
            ? error.message
            : "Could not start collection.",
      },
      { status: 409 },
    );
  }
}
