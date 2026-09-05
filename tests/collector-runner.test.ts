import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseConfig } from "../src/lib/collector/config";
import { collect, collectToDirectory, emptyState, parseState } from "../src/lib/collector/runner";
import type { CollectorPosting, CollectorSource } from "../src/lib/collector/types";
import { postingKey } from "../src/lib/collector/types";
import { importPayloadSchema } from "../src/lib/import/validation";

const source: CollectorSource = { provider: "ashby", board: "example", company: "Example", websiteUrl: null, enabled: true };
const other: CollectorSource = { ...source, provider: "lever", board: "other", company: "Other" };
const now = new Date("2026-09-05T16:00:00Z");
const config = () => parseConfig({ version: 1, sources: [source, other] });
function posting(s = source, id = "1"): CollectorPosting {
  return { ...s, externalId: id, title: "Data Engineer", companyWebsiteUrl: s.websiteUrl,
    locations: ["New York, NY"], country: "US", remoteType: "hybrid", employmentType: "FullTime",
    description: "Build Python SQL Spark Airflow Kafka pipelines. Requires 2 years of experience.",
    sourceUrl: `https://jobs.example.com/${s.board}/${id}`, salaryMin: 170000, salaryMax: 190000,
    datePosted: "2026-09-01", dateEvidence: "first_published", sourceUpdatedAt: null, warnings: [] };
}

test("merges sources into one validated batch and deduplicates stable provider identity", async () => {
  const result = await collect({ config: config(), now, fetchSource: async (s) => [posting(s), posting(s)] });
  assert.equal(result.report.complete, true);
  assert.equal(result.payload.jobs.length, 2);
  assert.equal(result.payload.source_name, "ats_collector_rules_v1");
  assert.equal(result.report.duplicateRows, 2);
  assert.equal(Object.keys(result.state.postings).length, 2);
  assert.equal(importPayloadSchema.safeParse(result.payload).success, true);
});

test("failure retains prior observations and prevents completeness without dropping good sources", async () => {
  const first = await collect({ config: config(), now, fetchSource: async (s) => [posting(s)] });
  const second = await collect({ config: config(), now: new Date("2026-09-06T16:00:00Z"), previousState: first.state,
    fetchSource: async (s) => { if (s.board === other.board) throw new Error("HTTP 503"); return []; } });
  assert.equal(second.report.complete, false);
  assert.equal(second.state.postings[postingKey(posting())].presence, "missing");
  assert.deepEqual(second.state.postings[postingKey(posting(other))], first.state.postings[postingKey(posting(other))]);
  assert.equal(first.state.postings[postingKey(posting())].presence, "present", "input state must not mutate");
  assert.equal(second.report.sources.find((s) => s.key === "lever:other")?.status, "failed");
});

test("reappearing posting retains first seen, clears missing marker, and never invents datePosted", async () => {
  const unknown = { ...posting(), datePosted: null, dateEvidence: "unknown" as const };
  const oneSource = parseConfig({ version: 1, sources: [source] });
  const first = await collect({ config: oneSource, now, fetchSource: async () => [unknown] });
  const missing = await collect({ config: oneSource, now: new Date("2026-09-06T16:00:00Z"), previousState: first.state, fetchSource: async () => [] });
  const found = await collect({ config: oneSource, now: new Date("2026-09-07T16:00:00Z"), previousState: missing.state, fetchSource: async () => [unknown] });
  const record = found.state.postings[postingKey(unknown)];
  assert.equal(record.firstSeenAt, now.toISOString());
  assert.equal(record.lastSeenAt, "2026-09-07T16:00:00.000Z");
  assert.equal(record.missingSince, null);
  assert.equal(found.payload.jobs[0].date_posted, null);
});

test("disabled sources are not requested or reconciled, and concurrency is bounded", async () => {
  const cfg = parseConfig({ version: 1, sources: [source, { ...other, enabled: false }], request: { concurrency: 1 } });
  const first = await collect({ config: config(), now, fetchSource: async (s) => [posting(s)] });
  const requested: string[] = [];
  const second = await collect({ config: cfg, now, previousState: first.state, fetchSource: async (s) => { requested.push(s.board); return []; } });
  assert.deepEqual(requested, [source.board]);
  assert.equal(second.state.postings[postingKey(posting(other))].presence, "present");
  let active = 0;
  let maximum = 0;
  await collect({ config: { ...config(), request: { ...config().request, concurrency: 1 } }, now,
    fetchSource: async () => { active++; maximum = Math.max(maximum, active); await new Promise((r) => setTimeout(r, 5)); active--; return []; } });
  assert.equal(maximum, 1);
});

test("uses local calendar date, validates real dates and rejects corrupted ledger", async () => {
  const result = await collect({ config: config(), now: new Date("2026-09-06T01:00:00Z"), fetchSource: async () => [] });
  assert.equal(result.payload.run_date, "2026-09-05");
  await assert.rejects(collect({ config: config(), now, runDate: "2026-02-30", fetchSource: async () => [] }), /date/i);
  assert.deepEqual(parseState(emptyState()), emptyState());
  assert.throws(() => parseState({ version: 1, postings: { broken: {} } }));
});

test("collection writes isolated audit files with payload hash and never performs a POST", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "collector-runner-"));
  try {
    const result = await collectToDirectory({ config: config(), now, outputDir, fetchSource: async (s) => [posting(s)] });
    const payload = JSON.parse(await readFile(path.join(result.runDir, "payload.json"), "utf8"));
    const report = JSON.parse(await readFile(path.join(result.runDir, "report.json"), "utf8"));
    assert.equal(payload.jobs.length, 2);
    assert.match(report.payloadSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.complete, true);
    assert.match(await readFile(path.join(result.runDir, "review.md"), "utf8"), /rules/i);
    assert.equal(parseState(JSON.parse(await readFile(path.join(outputDir, "state.json"), "utf8"))).version, 1);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test("overlapping output-directory collections cannot corrupt the ledger", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "collector-lock-"));
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const entered = new Promise<void>((r) => { started = r; });
  const first = collectToDirectory({ config: config(), now, outputDir, fetchSource: async () => { started(); await gate; return []; } });
  try {
    await entered;
    await assert.rejects(collectToDirectory({ config: config(), now, outputDir, fetchSource: async () => [] }), /lock|running/i);
  } finally { release(); await first; await rm(outputDir, { recursive: true, force: true }); }
});
