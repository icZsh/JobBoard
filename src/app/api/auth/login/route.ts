import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readJsonBody } from "@/lib/auth/body";
import { isSameOrigin } from "@/lib/auth/origin";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createAdminSession } from "@/lib/auth/session";
import { acquireLoginAttempt } from "@/lib/auth/throttle";
export const runtime = "nodejs";
const invalid = () =>
  Response.json(
    { errorMessage: "Invalid email or password." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return Response.json(
      { errorMessage: "Same-origin browser request required." },
      { status: 403 },
    );
  const release = acquireLoginAttempt();
  if (!release)
    return Response.json(
      { errorMessage: "Too many requests. Try again in a minute." },
      { status: 429 },
    );
  try {
    const input = z
      .strictObject({
        email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
        password: z.string().min(1).max(256),
      })
      .parse(await readJsonBody(request, 4096));
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (!user) {
      await hashPassword(input.password.padEnd(12, "\0"));
      return invalid();
    }
    if (
      !user.active ||
      user.role !== "ADMIN" ||
      (user.lockedUntil && user.lockedUntil > new Date())
    )
      return invalid();
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      const failed = await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
      });
      if (failed.failedLoginCount >= 5)
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: 0,
            lockedUntil: new Date(Date.now() + 15 * 60000),
          },
        });
      return invalid();
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await createAdminSession(user.id);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return invalid();
  } finally {
    release();
  }
}
