import { isSetupOpen } from "@/lib/auth/authorization";
import { bootstrapAdmin, SetupInputError } from "@/lib/auth/bootstrap";
import { readJsonBody } from "@/lib/auth/body";
import { isSameOrigin } from "@/lib/auth/origin";
import { createAdminSession } from "@/lib/auth/session";
import { acquireLoginAttempt } from "@/lib/auth/throttle";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return Response.json(
      { errorMessage: "Same-origin browser request required." },
      { status: 403 },
    );
  if (!(await isSetupOpen()))
    return Response.json(
      { errorMessage: "Setup has already been completed. Sign in instead." },
      { status: 409 },
    );
  const release = acquireLoginAttempt();
  if (!release)
    return Response.json(
      { errorMessage: "Too many requests. Try again in a minute." },
      { status: 429 },
    );
  try {
    const user = await bootstrapAdmin(await readJsonBody(request));
    await createAdminSession(user.id);
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (!(await isSetupOpen()))
      return Response.json(
        { errorMessage: "Setup is complete. Sign in to continue." },
        { status: 409 },
      );
    return Response.json(
      {
        errorMessage:
          error instanceof SetupInputError
            ? error.message
            : "Setup could not be completed. Check the server logs and try again.",
      },
      { status: error instanceof SetupInputError ? 400 : 500 },
    );
  } finally {
    release();
  }
}
