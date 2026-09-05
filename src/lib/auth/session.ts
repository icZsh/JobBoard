import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_DURATION_MS } from "./constants";
import { hashOpaqueToken } from "./token";

export async function createAdminSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_DURATION_MS);

  await prisma.$transaction([
    prisma.userSession.deleteMany({
      where: {
        userId,
        expiresAt: { lte: new Date() },
      },
    }),
    prisma.userSession.create({
      data: { tokenHash, userId, expiresAt },
    }),
  ]);

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure:
      process.env.AUTH_COOKIE_SECURE === "true" ||
      process.env.APP_URL?.startsWith("https://") === true,
    expires: expiresAt,
    path: "/",
    priority: "high",
  });
}

export async function deleteAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

  if (token) {
    await prisma.userSession.deleteMany({
      where: { tokenHash: hashOpaqueToken(token) },
    });
  }

  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

export async function getAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;

  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    return null;
  }

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          active: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt <= new Date()) {
    await prisma.userSession.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (!session.user.active || session.user.role !== "ADMIN") {
    return null;
  }

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    user: {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
    },
  };
}
