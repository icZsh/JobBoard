import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishDailyShortlist } from "../src/lib/jobs/daily-import";

const runDate = "2026-10-17";
const now = new Date("2026-10-17T16:30:00.000Z");
function payload() {
  return { run_date: runDate, source_name: "daily_data_job_shortlist", jobs: [{
    company: "Example", title: "Data Engineer", location: "New York, NY",
    source_url: "https://job-boards.greenhouse.io/example/jobs/12345", fit_score: 92, priority: "high",
  }] };
}
function exported() {
  return { exported_at: now.toISOString(), jobs: [] as Record<string, unknown>[],
    job_tracking: [] as Record<string, unknown>[], job_recommendations: [] as Record<string, unknown>[],
    import_runs: [] as Record<string, unknown>[] };
}
function receipt(count = 1) {
  return { ok: true, status: "SUCCESS", importRunId: "run-1", receivedJobs: count,
    importedJobs: count, recommendationsCreated: count, skippedDuplicateRows: 0, createdJobs: count, updatedJobs: 0 };
}
function recordSuccess(data: ReturnType<typeof exported>, submitted: ReturnType<typeof payload>, status = "SUCCESS") {
  data.import_runs.push({ id: "run-1", runDate, status, sourceName: submitted.source_name, rawPayload: submitted });
  for (const [index, job] of submitted.jobs.entries()) {
    const id = `job-${index}`;
    if (!data.jobs.some((existing) => existing.id === id)) data.jobs.push({ id, company: job.company,
      title: job.title, location: job.location, sourceUrl: job.source_url });
    data.job_recommendations.push({ jobId: id, importRunId: "run-1" });
  }
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const stateDir = await mkdtemp(join(tmpdir(), "daily-import-test-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const inputPath = join(stateDir, "input.json");
  await writeFile(inputPath, JSON.stringify(payload()));
  return { inputPath, stateDir, runDate, now: () => now };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("a changed same-day payload cannot replace an already successful import", async (t) => {
  const options = await fixture(t);
  const data = exported();
  recordSuccess(data, payload());
  const changed = payload(); changed.jobs[0].fit_score = 94;
  await writeFile(options.inputPath, JSON.stringify(changed));
  let posts = 0;
  await assert.rejects(publishDailyShortlist({ ...options, fetcher: async (_url, init) => {
    if (init?.method === "POST") posts++;
    return json(data);
  } }), /already.*import|successful.*import/i);
  assert.equal(posts, 0);
});

test("successful empty imports also block a second same-day payload without a local marker", async (t) => {
  const options = await fixture(t);
  const data = exported(); recordSuccess(data, { ...payload(), jobs: [] });
  let posts = 0;
  await assert.rejects(publishDailyShortlist({ ...options, fetcher: async (_url, init) => {
    if (init?.method === "POST") posts++;
    return json(data);
  } }), /already.*import|successful.*import/i);
  assert.equal(posts, 0);
});

test("the post-scan export filters newly applied jobs without changing discovery history", async (t) => {
  const options = await fixture(t);
  const discoveryHistory = join(options.stateDir, "recommendation-history.json");
  await writeFile(discoveryHistory, "discovery snapshot must stay unchanged");
  const data = exported();
  data.jobs.push({ id: "applied", company: "Example", title: "Data Engineer", location: "New York, NY",
    sourceUrl: payload().jobs[0].source_url });
  data.job_tracking.push({ jobId: "applied", status: "APPLIED", appliedAt: now.toISOString() });
  let submitted: unknown;
  const result = await publishDailyShortlist({ ...options, fetcher: async (_url, init) => {
    if (init?.method !== "POST") return json(data);
    submitted = JSON.parse(String(init.body)); return json(receipt(0), 201);
  } });
  assert.deepEqual(submitted, { ...payload(), jobs: [] });
  assert.equal(result.kind, "imported");
  assert.equal(await readFile(discoveryHistory, "utf8"), "discovery snapshot must stay unchanged");
  assert.equal(JSON.parse(await readFile(join(options.stateDir, `${runDate}.import-history.json`), "utf8")).generated_at, now.toISOString());
});

test("a committed POST with a lost response is reconciled without another POST", async (t) => {
  const options = await fixture(t); const data = exported(); let posts = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method !== "POST") return json(data);
    posts++;
    recordSuccess(data, JSON.parse(String(init.body)));
    throw new Error("response lost after commit");
  };
  assert.equal((await publishDailyShortlist({ ...options, fetcher })).kind, "recovered");
  assert.equal((await publishDailyShortlist({ ...options, fetcher })).kind, "already-imported");
  assert.equal(posts, 1);
  const saved = JSON.parse(await readFile(join(options.stateDir, `${runDate}.response.json`), "utf8"));
  assert.equal(saved.importRunId, "run-1"); assert.equal(saved.recovered, true);
  assert.equal(saved.createdJobs, undefined, "recovery must not invent create/update counts");
});

test("an unresolved POST stays blocked across invocations even when export shows no run yet", async (t) => {
  const options = await fixture(t); const data = exported(); let posts = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method !== "POST") return json(data);
    posts++; throw new Error("timeout before outcome is known");
  };
  await assert.rejects(publishDailyShortlist({ ...options, fetcher }), /unverified|unresolved/i);
  await assert.rejects(publishDailyShortlist({ ...options, fetcher }), /unverified|unresolved/i);
  assert.equal(posts, 1);
  await assert.rejects(readFile(join(options.stateDir, `${runDate}.sha256`)), /ENOENT/);
});

test("an invalid success response is never marked successful or blindly retried", async (t) => {
  const options = await fixture(t); let posts = 0;
  await assert.rejects(publishDailyShortlist({ ...options, fetcher: async (_url, init) => {
    if (init?.method !== "POST") return json(exported());
    posts++; return json({ ok: true, status: "SUCCESS" }, 201);
  } }), /unverified|unresolved/i);
  assert.equal(posts, 1);
  await assert.rejects(readFile(join(options.stateDir, `${runDate}.sha256`)), /ENOENT/);
});

test("pending server runs and unverified legacy markers fail closed", async (t) => {
  for (const mode of ["pending", "marker"] as const) {
    const options = await fixture(t); const data = exported(); let posts = 0;
    if (mode === "pending") recordSuccess(data, payload(), "PENDING");
    else await writeFile(join(options.stateDir, `${runDate}.sha256`), "legacy marker");
    await assert.rejects(publishDailyShortlist({ ...options, fetcher: async (_url, init) => {
      if (init?.method === "POST") posts++; return json(data);
    } }), /pending|unverified|unresolved/i);
    assert.equal(posts, 0);
  }
});

test("dry runs do not POST or create an attempt, and mark-imported cannot bypass verification", async (t) => {
  const options = await fixture(t); let posts = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === "POST") posts++; return json(exported());
  };
  assert.equal((await publishDailyShortlist({ ...options, fetcher, dryRun: true })).kind, "dry-run");
  await assert.rejects(readFile(join(options.stateDir, `${runDate}.attempt.json`)), /ENOENT/);
  await assert.rejects(publishDailyShortlist({ ...options, fetcher, markImported: true }), /verified|successful/i);
  assert.equal(posts, 0);
});

test("concurrent publishers reserve only one POST attempt", async (t) => {
  const options = await fixture(t); let posts = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method !== "POST") return json(exported());
    posts++; return json(receipt(), 201);
  };
  const results = await Promise.allSettled([
    publishDailyShortlist({ ...options, fetcher }), publishDailyShortlist({ ...options, fetcher }),
  ]);
  assert.equal(posts, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
});

test("reconciliation rejects missing recommendations instead of inventing duplicate skips", async (t) => {
  const options = await fixture(t); const data = exported(); recordSuccess(data, payload());
  data.job_recommendations = [];
  await assert.rejects(publishDailyShortlist({ ...options, fetcher: async () => json(data) }), /inconsistent.*count/i);
  await assert.rejects(readFile(join(options.stateDir, `${runDate}.sha256`)), /ENOENT/);
});

test("a malformed local receipt can be recovered from matching server evidence", async (t) => {
  const options = await fixture(t); const data = exported(); recordSuccess(data, payload());
  await writeFile(join(options.stateDir, `${runDate}.response.json`), "{partial");
  const result = await publishDailyShortlist({ ...options, fetcher: async () => json(data) });
  assert.equal(result.kind, "recovered");
  assert.equal(result.receipt?.importedJobs, 1);
});
