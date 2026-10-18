import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiscovery } from "../src/lib/discovery/runner";
import type { DiscoverySource, SourceScanResult } from "../src/lib/discovery/types";

const source: DiscoverySource = { id: "greenhouse:example", provider: "greenhouse", board: "example", company: "Example", enabled: true, evidence_url: "https://job-boards.greenhouse.io/example/jobs/123" };
const now = new Date("2026-10-16T16:00:00.000Z");
const posting = { key: "greenhouse:123", source_id: source.id, provider: "greenhouse" as const, external_id: "123", company: "Example", title: "Data Engineer II", location: "San Francisco, CA", source_url: source.evidence_url, description: "Build Python, SQL and Spark data pipelines. Requires 2+ years of data engineering experience.", employment_type: "FullTime", workplace_type: "Hybrid", published_at: null, published_at_kind: "unknown" as const };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "discovery-runner-test-"));
  const registryPath = join(dir, "sources.json"), historyPath = join(dir, "history.json"), stateDir = join(dir, "state");
  await writeFile(registryPath, JSON.stringify({ schema_version: 1, sources: [source] }));
  await writeFile(historyPath, JSON.stringify({ schema_version: 1, generated_at: now.toISOString(), jobs: [] }));
  return { dir, registryPath, historyPath, stateDir, now, runDate: "2026-10-16" };
}

test("scan saves a baseline; cached rerun rechecks tracking without fetching or refreshing first-seen", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const sourceFetcher = async (): Promise<SourceScanResult> => { calls++; return { source_id: source.id, success: true, postings: [posting], total_count: 1 }; };
    const first = await runDiscovery({ ...f, sourceFetcher });
    assert.equal(first.report.baseline, true);
    assert.equal(first.queue.candidates.length, 1);
    const originalPool = JSON.parse(await readFile(join(f.stateDir, "pool.json"), "utf8"));
    await writeFile(f.historyPath, JSON.stringify({ schema_version: 1, generated_at: now.toISOString(), jobs: [{ job_id: "1", company: "Example", title: posting.title, location: posting.location, source_url: posting.source_url + "?utm_source=test", status: "APPLIED", applied_at: now.toISOString(), recommended_run_dates: [] }] }));
    const second = await runDiscovery({ ...f, sourceFetcher, now: new Date(now.getTime() + 60_000) });
    assert.equal(calls, 1);
    assert.equal(second.report.cached, true);
    assert.equal(second.queue.candidates.length, 0);
    assert.equal(second.pool.postings[0].first_seen_at, originalPool.postings[0].first_seen_at);
    assert.equal(second.report.scan_completed_at, first.report.scan_completed_at);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("a new local date scans again; failure is explicit and preserves posting history", async () => {
  const f = await fixture();
  try {
    await runDiscovery({ ...f, sourceFetcher: async () => ({ source_id: source.id, success: true, postings: [posting], total_count: 1 }) });
    const next = new Date(now.getTime() + 86400000);
    await writeFile(f.historyPath, JSON.stringify({ schema_version: 1, generated_at: next.toISOString(), jobs: [] }));
    const failed = await runDiscovery({ ...f, now: next, runDate: "2026-10-17", sourceFetcher: async () => ({ source_id: source.id, success: false, postings: [], total_count: 0, error: "HTTP 503" }) });
    assert.equal(failed.report.status, "failed");
    assert.equal(failed.report.cached, false);
    assert.equal(failed.queue.candidates.length, 0);
    assert.equal(failed.pool.postings[0].availability, "unverified");
    assert.equal(failed.pool.postings[0].first_seen_at, now.toISOString());
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("stale history blocks before network and cannot replace a good output", async () => {
  const f = await fixture();
  try {
    let called = false;
    await assert.rejects(runDiscovery({ ...f, now: new Date(now.getTime() + 86400001), sourceFetcher: async () => { called = true; throw Error("unexpected"); } }), /stale/i);
    assert.equal(called, false);
    assert.equal(JSON.parse(await readFile(join(f.stateDir, "status.json"), "utf8")).status, "failed");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("a terminated scan's PID lock is recovered without requiring manual cleanup", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.stateDir, ".scan.lock"), { recursive: true });
    await writeFile(join(f.stateDir, ".scan.lock", "owner.json"), JSON.stringify({ pid: 2147483647 }));
    const result = await runDiscovery({ ...f, sourceFetcher: async () => ({ source_id: source.id, success: true, postings: [posting], total_count: 1 }) });
    assert.equal(result.report.status, "success");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("changing enabled boards invalidates scan cache and removes disabled-source candidates", async () => {
  const f = await fixture();
  try {
    await runDiscovery({ ...f, sourceFetcher: async () => ({ source_id: source.id, success: true, postings: [posting], total_count: 1 }) });
    await writeFile(f.registryPath, JSON.stringify({ schema_version: 1, sources: [{ ...source, enabled: false, exclusion_reason: "No longer targeted" }] }));
    await assert.rejects(runDiscovery({ ...f }), /enabled/i);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
