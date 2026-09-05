import {
  MinimumEnvelopeError,
  previewImportPayload,
} from "@/lib/import/import-service";
import { requireApiAdmin } from "@/lib/auth/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await requireApiAdmin(request); if (denied) return denied;
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        errorMessage: "Malformed JSON request body.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await previewImportPayload(payload);
    return Response.json(result);
  } catch (error) {
    if (error instanceof MinimumEnvelopeError) {
      return Response.json(
        {
          ok: false,
          errorMessage: error.message,
        },
        { status: 400 },
      );
    }

    const errorMessage =
      error instanceof Error ? error.message : "Import preview failed.";

    return Response.json(
      {
        ok: false,
        errorMessage,
      },
      { status: 500 },
    );
  }
}
