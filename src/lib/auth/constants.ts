import { createHash } from "node:crypto";

// Cookies ignore ports. Separate Compose projects on localhost need separate names.
export function sessionCookieName(instanceId?: string) {
  return instanceId
    ? `jobboard_admin_session_${createHash("sha256").update(instanceId).digest("hex").slice(0, 16)}`
    : "jobboard_admin_session";
}

export const ADMIN_SESSION_COOKIE = sessionCookieName(
  process.env.AUTH_INSTANCE_ID,
);
export const ADMIN_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
