import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "./session";
import { isSameOrigin } from "./origin";

export async function isSetupOpen() {
  const [bootstrap, users] = await Promise.all([
    prisma.bootstrap.findUnique({ where: { id: "admin" } }),
    prisma.user.count(),
  ]);
  return !bootstrap && users === 0;
}

export async function requireAdmin(destination = "/today") {
  const session = await getAdminSession();
  if (session) return session.user;
  if (await isSetupOpen()) redirect("/setup");
  redirect(`/login?next=${encodeURIComponent(destination)}`);
}

export async function hasAdminSession() {
  return Boolean(await getAdminSession());
}

export function unauthorizedApiResponse() {
  return Response.json(
    { ok: false, errorMessage: "Administrator authentication required." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export async function requireApiAdmin(
  request: Request,
): Promise<Response | null> {
  if (!(await hasAdminSession())) return unauthorizedApiResponse();
  if (!["GET", "HEAD"].includes(request.method) && !isSameOrigin(request)) {
    return Response.json(
      { ok: false, errorMessage: "Same-origin browser request required." },
      { status: 403 },
    );
  }
  return null;
}

export async function assertServerActionOrigin() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const origin = requestHeaders.get("origin");
  // Without APP_URL, compare the browser origin's host with Next's received Host.
  // A trusted reverse proxy should preserve Host; forwarded headers are not trusted.
  if (!origin || !host)
    throw new Error("Same-origin browser request required.");
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("Invalid browser origin.");
  }
  if (
    process.env.APP_URL
      ? !isSameOrigin(new Request(process.env.APP_URL, { headers: { origin } }))
      : !["http:", "https:"].includes(url.protocol) || url.host !== host
  ) {
    throw new Error("Same-origin browser request required.");
  }
}
