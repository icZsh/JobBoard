import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { submitRun } from "../src/lib/collector/submit";

const targetUrl = "http://127.0.0.1:3001/api/import-jobs";
const success = { ok: true, status: "SUCCESS", importRunId: "test-run", importedJobs: 1 };
const payload = '{"run_date":"2026-09-05","jobs":[{"title":"工程师","company":"Example"}]}\n';
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function fixture(body = payload, report: Record<string, unknown> = {}) {
  const runDir = await mkdtemp(join(tmpdir(), "collector-submit-"));
  await writeFile(join(runDir, "payload.json"), body);
  await writeFile(join(runDir, "report.json"), JSON.stringify({ complete: true, payloadSha256: sha256(body), ...report }));
  return runDir;
}

function mockFetch(fn: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>) {
  return fn as typeof fetch;
}

async function stateFiles(runDir: string) {
  return (await readdir(join(runDir, "import-state"))).sort();
}

test("sends exact UTF-8 payload once, keeps private durable evidence, and returns saved response on repeat", async (t) => {
  const runDir = await fixture();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  let calls = 0;
  const fetchImpl = mockFetch(async (url, init) => {
    calls++;
    assert.equal(url, targetUrl);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.body, payload);
    assert.ok(init?.signal);
    const files = await stateFiles(runDir);
    assert.equal(files.filter((file) => file.endsWith(".pending.json")).length, 1);
    return Response.json(success, { status: 201 });
  });
  assert.deepEqual(await submitRun({ runDir, targetUrl, fetchImpl }), { status: "imported", response: success });
  assert.deepEqual(await submitRun({ runDir, targetUrl, fetchImpl }), { status: "already-imported", response: success });
  assert.equal(calls, 1);
  const files = await stateFiles(runDir);
  assert.equal(files.length, 2);
  for (const file of files) assert.equal((await stat(join(runDir, "import-state", file))).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(join(runDir, "import-state", files.find((file) => file.endsWith(".success.json"))!), "utf8"));
  assert.deepEqual(saved.response, success);
});

test("isolates target endpoints and canonicalizes equivalent explicit URLs", async (t) => {
  const runDir = await fixture();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  let calls = 0;
  const fetchImpl = mockFetch(() => { calls++; return Response.json(success); });
  await submitRun({ runDir, targetUrl: "HTTP://LOCALHOST:80/api/import-jobs", fetchImpl });
  assert.equal((await submitRun({ runDir, targetUrl: "http://localhost/api/import-jobs", fetchImpl })).status, "already-imported");
  await submitRun({ runDir, targetUrl, fetchImpl });
  assert.equal(calls, 2);
});

test("refuses non-loopback targets, credentials, query, fragment, and other paths before calling fetch", async (t) => {
  const runDir = await fixture();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  const fetchImpl = mockFetch(() => { assert.fail("must not POST"); });
  for (const url of ["", "https://example.com/api/import-jobs", "http://192.168.1.2/api/import-jobs", "http://localhost.evil/api/import-jobs", "ftp://localhost/api/import-jobs", "http://user:password@localhost/api/import-jobs", "http://@localhost/api/import-jobs", "http://localhost/api/import-jobs?", "http://localhost/api/import-jobs?x=1", "http://localhost/api/import-jobs#", "http://localhost/api/import-jobs/", "http://localhost/api/other"]) {
    await assert.rejects(submitRun({ runDir, targetUrl: url, fetchImpl }), /endpoint/i);
  }
});

test("rejects incomplete, tampered, invalid, and empty artifacts before POST", async (t) => {
  for (const [body, report] of [
    [payload, { complete: false }],
    [payload, { payloadSha256: "0".repeat(64) }],
    ['{"run_date":"2026-09-05","jobs":[]}', {}],
    ['{"run_date":"2026-09-05","jobs":[{"title":"Missing company"}]}', {}],
    ["not json", {}],
  ] as [string, Record<string, unknown>][]) {
    const runDir = await fixture(body, report);
    t.after(() => rm(runDir, { recursive: true, force: true }));
    await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl: mockFetch(() => assert.fail("must not POST")) }));
  }
});

test("rejects symlinked input and invalid UTF-8 without submitting", async (t) => {
  const runDir = await fixture();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  await rm(join(runDir, "payload.json"));
  await symlink(join(runDir, "report.json"), join(runDir, "payload.json"));
  const fetchImpl = mockFetch(() => assert.fail("must not POST"));
  await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl }));
  await rm(join(runDir, "payload.json"));
  await writeFile(join(runDir, "payload.json"), Buffer.from([0xff]));
  await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl }), /UTF-8/);
});

test("all failed or ambiguous POST outcomes retain pending and block automatic resubmission", async (t) => {
  const outcomes = [
    () => { throw new Error("connection reset"); },
    () => Response.json({ ok: false, status: "FAILED" }, { status: 400 }),
    () => Response.json(success, { status: 500 }),
    () => Response.json({ ok: true, status: "PENDING" }),
    () => Response.json({ ok: true }),
    () => new Response("not json"),
    () => new Response(null, { status: 302, headers: { location: "https://example.com" } }),
    () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("body failed")); } })),
  ];
  for (const outcome of outcomes) {
    const runDir = await fixture();
    t.after(() => rm(runDir, { recursive: true, force: true }));
    let calls = 0;
    const fetchImpl = mockFetch(() => { calls++; return outcome(); });
    await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl }), /pending|reconcil/i);
    await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl }), /pending|reconcil/i);
    assert.equal(calls, 1);
    assert.deepEqual((await stateFiles(runDir)).map((file) => file.split(".").slice(1).join(".")), ["pending.json"]);
  }
});

test("an unwriteable success marker leaves the POST held for reconciliation", async (t) => {
  const runDir = await fixture();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  const key = sha256(`${targetUrl}\n${sha256(payload)}`);
  let calls = 0;
  const fetchImpl = mockFetch(async () => {
    calls++;
    await mkdir(join(runDir, "import-state", `${key}.success.json`));
    return Response.json(success);
  });
  await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl }), /pending|reconcil/i);
  await rm(join(runDir, "import-state", `${key}.success.json`), { recursive: true });
  await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl }), /pending|reconcil/i);
  assert.equal(calls, 1);
});

test("parallel calls cannot issue duplicate requests", async (t) => {
  const runDir = await fixture();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  let release!: () => void;
  let started!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  const fetchImpl = mockFetch(async () => { calls++; started(); await hold; return Response.json(success); });
  const first = submitRun({ runDir, targetUrl, fetchImpl });
  await ready;
  await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl }), /lock|progress|pending/i);
  release();
  await first;
  assert.equal(calls, 1);
});

test("bounds both request and response body waits to 30 seconds and retains pending", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const stuckAt of ["request", "body"]) {
    const runDir = await fixture();
    t.after(() => rm(runDir, { recursive: true, force: true }));
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let signal: AbortSignal | null | undefined;
    let calls = 0;
    const fetchImpl = mockFetch((_url, init) => {
      calls++;
      signal = init?.signal;
      started();
      return stuckAt === "request"
        ? new Promise<Response>(() => {})
        : new Response(new ReadableStream());
    });
    const pending = submitRun({ runDir, targetUrl, fetchImpl });
    const rejected = assert.rejects(pending, /pending|reconcil/i);
    await ready;
    t.mock.timers.tick(30_001);
    await rejected;
    assert.equal(signal?.aborted, true);
    await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl }), /pending|reconcil/i);
    assert.equal(calls, 1);
  }
});

test("corrupt success state and symbolic-link state directories are never treated as permission to repeat", async (t) => {
  const runDir = await fixture();
  t.after(() => rm(runDir, { recursive: true, force: true }));
  const key = sha256(`${targetUrl}\n${sha256(payload)}`);
  const stateDir = join(runDir, "import-state");
  await mkdir(stateDir);
  await writeFile(join(stateDir, `${key}.success.json`), JSON.stringify({ response: success }));
  const fetchImpl = mockFetch(() => assert.fail("must not POST"));
  await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl }), /reconcil/i);
  await rm(stateDir, { recursive: true });
  await symlink(runDir, stateDir);
  await assert.rejects(submitRun({ runDir, targetUrl, fetchImpl }), /symbolic link/i);
});
