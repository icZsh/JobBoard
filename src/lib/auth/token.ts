import { createHash, timingSafeEqual } from "node:crypto";

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function safelyCompareTokens(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
