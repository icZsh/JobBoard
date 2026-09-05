import assert from "node:assert/strict";
import test from "node:test";
import { isSameOrigin } from "../src/lib/auth/origin";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { getSafeLoginDestination } from "../src/lib/auth/navigation";
import { hashOpaqueToken, safelyCompareTokens } from "../src/lib/auth/token";
import { acquireLoginAttempt } from "../src/lib/auth/throttle";
import { readJsonBody } from "../src/lib/auth/body";
import { sessionCookieName } from "../src/lib/auth/constants";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

test("cookie mutations require an exact origin including protocol and port", () => {
  const request = (origin?: string) =>
    new Request("http://localhost:3000/api/settings", {
      headers: origin ? { origin } : {},
    });
  assert.equal(isSameOrigin(request("http://localhost:3000"), ""), true);
  for (const origin of [
    undefined,
    "null",
    "http://localhost:3001",
    "https://localhost:3000",
    "http://localhost:3000.evil.test",
    "http://localhost:3000/path",
  ])
    assert.equal(isSameOrigin(request(origin), ""), false, origin);
  assert.equal(
    isSameOrigin(request("https://jobs.example"), "https://jobs.example"),
    true,
  );
  assert.equal(
    isSameOrigin(request("http://localhost:3000"), "https://jobs.example"),
    false,
  );
  assert.equal(
    isSameOrigin(
      new Request("http://0.0.0.0:3000/api/setup", {
        headers: { host: "localhost:3017", origin: "http://localhost:3017" },
      }),
      "",
    ),
    true,
  );
  assert.equal(
    isSameOrigin(
      new Request("http://0.0.0.0:3000/api/setup", {
        headers: {
          host: "localhost:3017",
          origin: "http://evil.example",
          "x-forwarded-host": "evil.example",
        },
      }),
      "",
    ),
    false,
  );
  assert.equal(
    isSameOrigin(
      new Request("http://0.0.0.0:3000/api/setup", {
        headers: {
          host: "rebound.example:3017",
          origin: "http://rebound.example:3017",
        },
      }),
      "",
    ),
    false,
  );
  assert.equal(
    isSameOrigin(
      new Request("http://0.0.0.0:3000/api/setup", {
        headers: { host: "127.0.0.1:3017", origin: "http://127.0.0.1:3017" },
      }),
      "",
    ),
    true,
  );
});

test("login redirects are restricted to local application destinations", () => {
  assert.equal(
    getSafeLoginDestination("/jobs/123?tab=resume"),
    "/jobs/123?tab=resume",
  );
  assert.equal(getSafeLoginDestination("/settings/resume"), "/settings/resume");
  for (const value of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/login",
    "/api/export",
    "/today/../../login",
  ])
    assert.equal(getSafeLoginDestination(value), "/today");
});

test("instance-scoped cookie names isolate localhost deployments without exposing instance text", () => {
  assert.equal(sessionCookieName(), "jobboard_admin_session");
  assert.equal(sessionCookieName(""), "jobboard_admin_session");
  const original = sessionCookieName("acceptance-original");
  const restored = sessionCookieName("acceptance-restored");
  assert.match(original, /^jobboard_admin_session_[a-f0-9]{16}$/u);
  assert.equal(sessionCookieName("acceptance-original"), original);
  assert.notEqual(restored, original);
  assert.equal(original.includes("acceptance-original"), false);
  assert.match(
    sessionCookieName("instance; path=/\r\nunsafe"),
    /^jobboard_admin_session_[a-f0-9]{16}$/u,
  );
});

test("scrypt passwords reject wrong values and malformed hashes; only session token digests are stored", async () => {
  const password = "A long password for tests";
  const encoded = await hashPassword(password);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
  assert.equal(await verifyPassword(password, `${encoded}$extra`), false);
  assert.equal(
    await verifyPassword(password, encoded.replace("131072", "1")),
    false,
  );
  await assert.rejects(() => hashPassword("short"));
  await assert.rejects(() => hashPassword("x".repeat(257)));
  assert.notEqual(hashOpaqueToken("session-secret"), "session-secret");
  assert.equal(safelyCompareTokens("token", "token"), true);
  assert.equal(safelyCompareTokens("token", "longer-token"), false);
});

test("login throttle bounds concurrent password hashing and total attempts", () => {
  const first = acquireLoginAttempt(1000);
  const second = acquireLoginAttempt(1000);
  assert.ok(first && second);
  assert.equal(acquireLoginAttempt(1000), null);
  first();
  first();
  second();
  for (let index = 0; index < 18; index++) {
    const release = acquireLoginAttempt(1000);
    assert.ok(release);
    release();
  }
  assert.equal(acquireLoginAttempt(1000), null);
  const release = acquireLoginAttempt(62000);
  assert.ok(release);
  release();
});

test("setup/login configuration bodies enforce JSON and byte limits before parsing", async () => {
  const request = (body: string, contentType = "application/json") =>
    new Request("http://localhost/api/setup", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
  assert.deepEqual(await readJsonBody(request('{"ok":true}')), { ok: true });
  await assert.rejects(
    () => readJsonBody(request('{"large":"1234567890"}'), 10),
    /too large/,
  );
  await assert.rejects(
    () => readJsonBody(request("{}", "text/plain")),
    /application\/json/,
  );
});

test("all application entrypoints declare authentication except setup, login, and boolean health", async () => {
  const root = path.join(process.cwd(), "src/app");
  const files = await readdir(root, { recursive: true });
  const publicApis = new Set([
    "api/setup/route.ts",
    "api/auth/login/route.ts",
    "api/health/route.ts",
  ]);
  for (const file of files.filter((file) => file.endsWith("/route.ts"))) {
    const code = await readFile(path.join(root, file), "utf8");
    if (publicApis.has(file)) continue;
    assert.match(
      code,
      /await requireApiAdmin\(request\)/u,
      `${file} must check authentication and mutation origin.`,
    );
  }
  for (const file of files.filter(
    (file) => file === "page.tsx" || file.endsWith("/page.tsx"),
  )) {
    if (["setup/page.tsx", "login/page.tsx"].includes(file)) continue;
    assert.match(
      await readFile(path.join(root, file), "utf8"),
      /await requireAdmin\(/u,
      `${file} must require administrator access.`,
    );
  }
  for (const file of files.filter((file) => file.endsWith("/actions.ts"))) {
    const code = await readFile(path.join(root, file), "utf8");
    assert.match(
      code,
      /await requireAdmin\(/u,
      `${file} must authenticate server actions.`,
    );
    assert.match(
      code,
      /await assertServerActionOrigin\(/u,
      `${file} must check action origin.`,
    );
  }
});
