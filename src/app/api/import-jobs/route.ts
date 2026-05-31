import { importJobsPayload, MinimumEnvelopeError } from "@/lib/import/import-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
    const result = await importJobsPayload(payload);

    return Response.json(result, {
      status: result.ok
        ? 201
        : result.errorKind === "validation"
          ? 400
          : 500,
    });
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
      error instanceof Error ? error.message : "Import failed unexpectedly.";

    return Response.json(
      {
        ok: false,
        errorMessage,
      },
      { status: 500 },
    );
  }
}
