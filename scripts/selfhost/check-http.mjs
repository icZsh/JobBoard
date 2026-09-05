import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Explicit opt-in, target, and disposable account are mandatory. This script
// creates acceptance-only job/resume fixtures and never deletes existing data,
// changes valid configuration, confirms a new active resume, or starts collection.
if (process.env.JOBBOARD_ACCEPTANCE_TESTS !== "1")
  throw new Error(
    "Set JOBBOARD_ACCEPTANCE_TESTS=1 for an isolated acceptance deployment.",
  );
if (process.argv.length !== 4 || process.argv[2] !== "--target")
  throw new Error(
    "Usage: node scripts/selfhost/check-http.mjs --target http://localhost:EXPLICIT_PORT",
  );
const target = new URL(process.argv[3]);
if (
  !["http:", "https:"].includes(target.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  !target.port ||
  target.username ||
  target.password ||
  target.pathname !== "/" ||
  target.search ||
  target.hash
) {
  throw new Error(
    "Acceptance target must be an explicit loopback origin with a non-default explicit port and no credentials, path, query, or fragment.",
  );
}
const email = process.env.TEST_ADMIN_EMAIL;
const password = process.env.TEST_ADMIN_PASSWORD;
if (!email || !password)
  throw new Error(
    "Provide TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD for a disposable administrator account.",
  );
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const output = path.join(root, ".selfhost-validation/http-checks.json");
const report = {
  startedAt: new Date().toISOString(),
  target: target.origin,
  checks: [],
  fixtures: { uploadedResumes: [], jobIds: [] },
  completed: false,
};
let cookie = "";
const token = randomUUID();
const company = `Acceptance Test ${token}`;

async function request(
  route,
  {
    method = "GET",
    body,
    authenticated = false,
    origin = target.origin,
    headers: extra = {},
  } = {},
) {
  const headers = new Headers(extra);
  if (origin !== null && !["GET", "HEAD"].includes(method))
    headers.set("Origin", origin);
  if (authenticated) headers.set("Cookie", cookie);
  let sent = body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    sent = JSON.stringify(body);
  }
  return fetch(new URL(route, target), {
    method,
    body: sent,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
}

async function check(name, action) {
  const started = Date.now();
  try {
    const details = await action();
    report.checks.push({
      name,
      passed: true,
      durationMs: Date.now() - started,
      ...(details ? { details } : {}),
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    // Never include request headers, passwords, cookies, or response bodies.
    report.checks.push({
      name,
      passed: false,
      durationMs: Date.now() - started,
      error:
        error instanceof Error ? error.message : "Acceptance check failed.",
    });
    throw new Error(`Acceptance check failed: ${name}`);
  }
}

async function exportData() {
  const response = await request("/api/export", { authenticated: true });
  assert.equal(response.status, 200, "Authenticated export must succeed.");
  return response.json();
}
function activeResume(data) {
  return (
    data.settings.find((setting) => setting.key === "activeResumeId")?.value ??
    null
  );
}
async function upload(name, bytes) {
  const body = new FormData();
  body.set("file", new Blob([bytes]), name);
  return request("/api/resumes", { method: "POST", authenticated: true, body });
}

try {
  await check(
    "private pages redirect anonymous requests to login",
    async () => {
      const pages = [
        "/",
        "/today",
        "/board",
        "/import",
        "/settings",
        "/settings/resume",
        "/jobs/acceptance-probe",
      ];
      for (const route of pages) {
        const response = await request(route);
        assert.ok(
          [303, 307, 308].includes(response.status),
          `${route} must redirect before revealing private data.`,
        );
        assert.equal(
          new URL(response.headers.get("location"), target).pathname,
          "/login",
          `${route} must redirect to login.`,
        );
      }
      return { pages: pages.length };
    },
  );
  await check("private APIs reject unauthenticated requests", async () => {
    const routes = [
      ["GET", "/api/export"],
      ["GET", "/api/collection-config"],
      ["PUT", "/api/collection-config"],
      ["GET", "/api/collection-runs"],
      ["POST", "/api/import-jobs"],
      ["POST", "/api/import-jobs/preview"],
      ["PATCH", "/api/jobs/acceptance-probe/tracking"],
      ["POST", "/api/jobs/acceptance-probe/tailor-resume"],
      ["POST", "/api/resumes"],
      ["POST", "/api/resumes/acceptance-probe/confirm"],
      ["GET", "/api/resumes/acceptance-probe/download"],
      ["POST", "/api/auth/logout"],
    ];
    for (const [method, route] of routes)
      assert.equal(
        (
          await request(route, {
            method,
            ...(method === "GET" ? {} : { body: {} }),
          })
        ).status,
        401,
        `${method} ${route} must require a session.`,
      );
    return { APIs: routes.length, collectionPOSTNotCalled: true };
  });
  await check("invalid login and cross-origin login fail", async () => {
    assert.equal(
      (
        await request("/api/auth/login", {
          method: "POST",
          body: { email, password: `incorrect-${token}` },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/api/auth/login", {
          method: "POST",
          origin: "https://cross-origin.example",
          body: { email, password },
        })
      ).status,
      403,
    );
  });
  await check("login establishes a protected session cookie", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(
      response.status,
      200,
      "Disposable administrator login must succeed.",
    );
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie") ?? ""];
    const session = setCookies.find((value) =>
      /^jobboard_admin_session(?:_[a-f0-9]+)?=/u.test(value),
    );
    assert.ok(Boolean(session), "Login must issue its session cookie.");
    assert.ok(
      /;\s*HttpOnly(?:;|$)/iu.test(session),
      "Session cookie must be HttpOnly.",
    );
    assert.ok(
      /;\s*SameSite=Strict(?:;|$)/iu.test(session),
      "Session cookie must be SameSite=Strict.",
    );
    assert.ok(
      /;\s*Path=\/(?:;|$)/iu.test(session),
      "Session cookie must cover the app path.",
    );
    assert.ok(/;\s*Expires=/iu.test(session), "Session cookie must expire.");
    if (target.protocol === "https:")
      assert.ok(
        /;\s*Secure(?:;|$)/iu.test(session),
        "HTTPS session must be Secure.",
      );
    cookie = session.split(";")[0];
    assert.equal(
      (await request("/api/collection-config", { authenticated: true })).status,
      200,
    );
    return {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      expires: true,
      secure: /;\s*Secure(?:;|$)/iu.test(session),
    };
  });
  await check(
    "cross-origin and missing-origin mutations are rejected",
    async () => {
      for (const origin of ["https://cross-origin.example", null])
        assert.equal(
          (
            await request("/api/collection-config", {
              method: "PUT",
              body: {},
              authenticated: true,
              origin,
            })
          ).status,
          403,
        );
      assert.equal(
        (
          await request("/api/auth/logout", {
            method: "POST",
            authenticated: true,
            origin: "https://cross-origin.example",
          })
        ).status,
        403,
      );
      assert.equal(
        (await request("/api/collection-config", { authenticated: true }))
          .status,
        200,
        "Rejected logout must keep the session valid.",
      );
    },
  );
  await check(
    "setup remains closed after the first administrator exists",
    async () => {
      assert.equal(
        (await request("/api/setup", { method: "POST", body: {} })).status,
        409,
      );
    },
  );
  await check(
    "invalid configuration cannot replace saved preferences",
    async () => {
      const before = await (
        await request("/api/collection-config", { authenticated: true })
      ).json();
      assert.ok(
        Boolean(before.config),
        "Existing deployment must have saved configuration.",
      );
      assert.equal(
        (
          await request("/api/collection-config", {
            method: "PUT",
            body: {
              timezone: "Mars/Invalid",
              schedule: { enabled: false, time: "99:99" },
              preferences: {},
              sources: [],
            },
            authenticated: true,
          })
        ).status,
        400,
      );
      const after = await (
        await request("/api/collection-config", { authenticated: true })
      ).json();
      assert.ok(
        JSON.stringify(before) === JSON.stringify(after),
        "Invalid update must leave the entire configuration unchanged.",
      );
    },
  );

  const baselineActive = activeResume(await exportData());
  assert.ok(
    Boolean(baselineActive),
    "Acceptance deployment must already have a confirmed resume to check preservation.",
  );
  if (process.env.TEST_EXPECTED_ACTIVE_RESUME_ID)
    assert.equal(baselineActive, process.env.TEST_EXPECTED_ACTIVE_RESUME_ID);
  for (const extension of ["txt", "md", "docx", "pdf"]) {
    await check(
      `upload and download ${extension.toUpperCase()} preserves exact bytes`,
      async () => {
        const bytes = await readFile(
          path.join(root, `tests/fixtures/resumes/resume.${extension}`),
        );
        const response = await upload(
          `acceptance-${token}.${extension}`,
          bytes,
        );
        assert.equal(response.status, 201, "Fixture upload must succeed.");
        const uploaded = await response.json();
        assert.ok(typeof uploaded.id === "string");
        assert.ok(
          /Jordan Sample/u.test(uploaded.extractedText),
          "Fixture text must be extracted.",
        );
        report.fixtures.uploadedResumes.push({ id: uploaded.id, extension });
        const route = `/api/resumes/${uploaded.id}/download`;
        assert.equal(
          (await request(route)).status,
          401,
          "Download must require authentication.",
        );
        const downloaded = await request(route, { authenticated: true });
        assert.equal(downloaded.status, 200);
        assert.ok(
          /attachment;/iu.test(
            downloaded.headers.get("content-disposition") ?? "",
          ),
        );
        assert.equal(
          downloaded.headers.get("x-content-type-options"),
          "nosniff",
        );
        assert.ok(
          bytes.equals(Buffer.from(await downloaded.arrayBuffer())),
          "Download bytes must equal the uploaded file.",
        );
        assert.equal(
          activeResume(await exportData()),
          baselineActive,
          "Uploading an unconfirmed file must not replace the active resume.",
        );
        return {
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      },
    );
  }
  await check(
    "invalid and encrypted uploads and empty confirmation preserve the active resume",
    async () => {
      assert.equal(
        (
          await upload(
            `acceptance-${token}.exe`,
            Buffer.from("not a supported document"),
          )
        ).status,
        400,
      );
      assert.equal(
        (await upload(`acceptance-empty-${token}.txt`, Buffer.alloc(0))).status,
        400,
      );
      assert.equal(
        (
          await upload(
            `acceptance-encrypted-${token}.pdf`,
            await readFile(
              path.join(root, "tests/fixtures/resumes/encrypted.pdf"),
            ),
          )
        ).status,
        400,
      );
      const id = report.fixtures.uploadedResumes[0].id;
      assert.equal(
        (
          await request(`/api/resumes/${id}/confirm`, {
            method: "POST",
            authenticated: true,
            body: { text: "   " },
          })
        ).status,
        400,
      );
      assert.equal(
        activeResume(await exportData()),
        baselineActive,
        "All rejected resume changes must leave the prior confirmed resume active.",
      );
    },
  );
  await check(
    "job reimport preserves personal tracking and notes",
    async () => {
      const sourceUrl = `https://example.invalid/acceptance/${token}`;
      const job = {
        title: "Acceptance Test Data Engineer",
        company,
        location: "New York, NY",
        source_url: sourceUrl,
        description:
          "Company: Acceptance fixture\n\nBenefits: Unverified\n\nRole: Disposable HTTP acceptance job.",
        fit_score: 20,
        matched_skills: [],
        missing_skills: [],
        match_reason: "HTTP acceptance fixture only.",
        concerns: "Synthetic acceptance fixture.",
        suggested_action: "Review today.",
      };
      const payload = {
        run_date: new Date().toISOString().slice(0, 10),
        source_name: `http_acceptance_${token}`,
        jobs: [job],
      };
      const imported = await request("/api/import-jobs", {
        method: "POST",
        authenticated: true,
        body: payload,
      });
      assert.equal(
        imported.status,
        201,
        "Acceptance fixture import must succeed.",
      );
      assert.equal((await imported.json()).ok, true);
      const first = await exportData();
      const found = first.jobs.filter(
        (item) => item.company === company && item.sourceUrl === sourceUrl,
      );
      assert.equal(found.length, 1);
      const id = found[0].id;
      report.fixtures.jobIds.push(id);
      const notes = `Preserve HTTP acceptance notes ${token}`;
      const patched = await request(`/api/jobs/${id}/tracking`, {
        method: "PATCH",
        authenticated: true,
        body: {
          status: "INTERESTED",
          notes,
          nextAction: "Acceptance follow-up",
        },
      });
      assert.equal(patched.status, 200);
      assert.equal(
        (
          await request("/api/import-jobs", {
            method: "POST",
            authenticated: true,
            body: {
              ...payload,
              jobs: [
                {
                  ...job,
                  description: `${job.description}\nUpdated source description.`,
                },
              ],
            },
          })
        ).status,
        201,
      );
      const after = await exportData();
      assert.equal(
        after.jobs.filter(
          (item) => item.company === company && item.sourceUrl === sourceUrl,
        ).length,
        1,
        "Reimport must reuse the original job.",
      );
      const tracking = after.job_tracking.find((item) => item.jobId === id);
      assert.equal(tracking?.status, "INTERESTED");
      assert.equal(tracking?.notes, notes);
      assert.equal(tracking?.nextAction, "Acceptance follow-up");
      assert.equal(activeResume(after), baselineActive);
      return {
        distinctFixtureCompany: company,
        reimportReusedJob: true,
        trackingPreserved: true,
      };
    },
  );
  await check("logout revokes the session server-side", async () => {
    assert.equal(
      (
        await request("/api/auth/logout", {
          method: "POST",
          authenticated: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/export", { authenticated: true })).status,
      401,
      "Replaying the old cookie after logout must fail.",
    );
    assert.equal(
      (
        await request(
          `/api/resumes/${report.fixtures.uploadedResumes[0].id}/download`,
          { authenticated: true },
        )
      ).status,
      401,
    );
    cookie = "";
  });
  report.completed = true;
} catch (error) {
  report.failure =
    error instanceof Error ? error.message : "Acceptance checks failed.";
  process.exitCode = 1;
} finally {
  // A failed assertion must not leave this script's own disposable session live.
  if (cookie) {
    await request("/api/auth/logout", {
      method: "POST",
      authenticated: true,
    }).catch(() => {});
    cookie = "";
  }
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter((check) => check.passed).length,
    failed: report.checks.filter((check) => !check.passed).length,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    `${report.summary.passed} passed; ${report.summary.failed} failed. Report: ${output}`,
  );
}
