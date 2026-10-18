import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRecommendationPayload,
  findMatchingHistory,
  getStablePostingId,
  parseRecommendationHistory,
  sanitizeRecommendationHistory,
  type RecommendationHistoryJob,
} from "../src/lib/jobs/recommendation-history";

const now = new Date("2026-10-15T01:00:00.000Z");
const ashbyId = "375e5c16-b4a7-475a-8a5b-5c98c01ff512";
const leverId = "64b01794-30ab-422f-b811-bd08372a2f33";

function historyJob(overrides: Partial<RecommendationHistoryJob> = {}): RecommendationHistoryJob {
  return {
    job_id: "job-a",
    company: "Example",
    title: "Data Engineer",
    location: "San Francisco",
    source_url: "https://job-boards.greenhouse.io/example/jobs/123",
    status: "NEW",
    applied_at: null,
    recommended_run_dates: [],
    ...overrides,
  };
}

function snapshot(jobs: RecommendationHistoryJob[] = []) {
  return { schema_version: 1 as const, generated_at: now.toISOString(), jobs };
}

function listing(source_url = "https://job-boards.greenhouse.io/example/jobs/123") {
  return { company: "Example", title: "Data Engineer", location: "San Francisco", source_url, fit_score: 96, priority: "high" };
}

test("sanitizer exports only listing identity, tracking state and successful recommendation dates", () => {
  const result = sanitizeRecommendationHistory({
    exported_at: now.toISOString(),
    jobs: [{ id: "job-a", company: "Example", title: "Data Engineer", location: null, sourceUrl: null, description: "private raw description" }],
    job_tracking: [{ jobId: "job-a", status: "INTERESTED", appliedAt: "2026-10-01T12:00:00.000Z", notes: "private note", resumePath: "private resume" }],
    import_runs: [
      { id: "good", status: "SUCCESS", runDate: "2026-10-08T00:00:00.000Z", rawPayload: { private: true } },
      { id: "failed", status: "FAILED", runDate: "2026-10-09T00:00:00.000Z" },
      { id: "pending", status: "PENDING", runDate: "2026-10-10T00:00:00.000Z" },
    ],
    job_recommendations: [
      { jobId: "job-a", importRunId: "good", rawRecommendation: "private" },
      { jobId: "job-a", importRunId: "good" },
      { jobId: "job-a", importRunId: "failed" },
      { jobId: "job-a", importRunId: "pending" },
    ],
    settings: [{ value: "private secret" }],
  });
  assert.deepEqual(result, snapshot([historyJob({ location: null, source_url: null, status: "INTERESTED", applied_at: "2026-10-01T12:00:00.000Z", recommended_run_dates: ["2026-10-08"] })]));
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("sanitizer fails closed on malformed exports or broken relational history", () => {
  assert.throws(() => sanitizeRecommendationHistory({ jobs: [] }));
  assert.throws(() => sanitizeRecommendationHistory({ exported_at: now.toISOString(), jobs: [], job_tracking: [], import_runs: [], job_recommendations: [{ jobId: "missing", importRunId: "missing" }] }));
});

test("history snapshot rejects stale, future and impossible dates", () => {
  assert.doesNotThrow(() => parseRecommendationHistory({ ...snapshot(), generated_at: "2026-10-14T01:00:00.000Z" }, now));
  assert.throws(() => parseRecommendationHistory({ ...snapshot(), generated_at: "2026-10-14T00:59:59.999Z" }, now), /stale/i);
  assert.throws(() => parseRecommendationHistory({ ...snapshot(), generated_at: "2026-10-15T01:00:00.001Z" }, now), /future/i);
  assert.throws(() => parseRecommendationHistory(snapshot([historyJob({ recommended_run_dates: ["2026-02-30"] })]), now));
});

test("stable ATS identities survive application URLs, custom hosts and tracking parameters", () => {
  assert.equal(getStablePostingId("https://www.example.com/careers?gh_jid=123&utm_source=feed"), "greenhouse:123");
  assert.equal(getStablePostingId("https://boards.greenhouse.io/example/jobs/123"), "greenhouse:123");
  assert.equal(getStablePostingId(`https://jobs.ashbyhq.com/example/${ashbyId}/application?utm_source=feed`), `ashby:${ashbyId}`);
  const matches = findMatchingHistory(listing(`https://jobs.ashbyhq.com/example/${ashbyId}/application`), [historyJob({ source_url: `https://jobs.ashbyhq.com/example/${ashbyId}` })]);
  assert.equal(matches.matches.length, 1);
});

test("Lever UUID identities survive global/EU hosts, apply paths and tracking parameters", () => {
  for (const host of ["jobs.lever.co", "jobs.eu.lever.co"]) {
    for (const suffix of ["", "/apply", "/?lever-source=LinkedIn&utm_source=feed#apply"]) {
      assert.equal(getStablePostingId(`https://${host}/example/${leverId.toUpperCase()}${suffix}`), `lever:${leverId}`);
    }
  }
  for (const url of [
    `https://jobs.lever.co.example.com/example/${leverId}`,
    `https://example.com/example/${leverId}`,
    `https://jobs.lever.co/${leverId}`,
    `https://jobs.lever.co/example/${leverId}extra`,
    "https://jobs.lever.co/example/not-a-uuid/apply",
  ]) assert.equal(getStablePostingId(url), null);
});

test("fresh history blocks applied Lever aliases while preserving a different requisition", () => {
  const otherId = "64b01794-30ab-422f-b811-bd08372a2f34";
  for (const host of ["jobs.lever.co", "jobs.eu.lever.co"]) {
    const applied = historyJob({
      source_url: `https://${host}/example/${leverId}/apply?lever-source=LinkedIn`,
      status: "APPLIED", applied_at: "2026-10-15T00:59:00.000Z",
    });
    const newPosting = listing(`https://${host}/example/${otherId}`);
    const result = filterRecommendationPayload({
      run_date: "2026-10-15", jobs: [listing(`https://${host}/example/${leverId}?utm_source=board`), newPosting],
    }, snapshot([applied]), now);
    assert.deepEqual(result.payload.jobs, [newPosting]);
    assert.equal(result.suppressions[0].reason, "already_applied_or_in_pipeline");
  }
});

test("URL aliases aggregate applied tracking without merging different requisition IDs", () => {
  const jobs = [
    historyJob(),
    historyJob({ job_id: "job-b", source_url: "https://example.com/careers?gh_jid=123", status: "APPLIED", applied_at: "2026-10-01T00:00:00.000Z" }),
    historyJob({ job_id: "job-c", source_url: "https://job-boards.greenhouse.io/example/jobs/456", status: "NEW" }),
  ];
  assert.deepEqual(findMatchingHistory(listing(), jobs).matches.map((job) => job.job_id), ["job-a", "job-b"]);
  const result = filterRecommendationPayload({ run_date: "2026-10-15", jobs: [listing(), listing("https://job-boards.greenhouse.io/example/jobs/456")] }, snapshot(jobs), now);
  assert.equal(result.payload.jobs.length, 1);
  assert.equal((result.payload.jobs[0] as { source_url: string }).source_url.endsWith("/456"), true);
  assert.equal(result.suppressions[0].reason, "already_applied_or_in_pipeline");
});

test("fallback needs company, title and location and refuses ambiguous identities", () => {
  const noUrl = { ...listing(), source_url: null };
  assert.equal(findMatchingHistory(noUrl, [historyJob()]).matches.length, 1);
  assert.equal(findMatchingHistory({ ...noUrl, location: null }, [historyJob({ location: null })]).matches.length, 0);
  const ambiguous = findMatchingHistory(noUrl, [historyJob(), historyJob({ job_id: "job-b", source_url: "https://job-boards.greenhouse.io/example/jobs/456" })]);
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(ambiguous.matches.length, 0);
});

test("filter dedupes payload aliases and preserves original field casing and extension fields", () => {
  const first = { ...listing(), custom: "keep" };
  const result = filterRecommendationPayload({ run_date: "2026-10-15", source_name: "test", jobs: [first, listing("https://example.com/jobs?gh_jid=123")] }, snapshot(), now);
  assert.deepEqual(result.payload.jobs, [first]);
  assert.equal(result.suppressions[0].reason, "duplicate_in_payload");
});

test("same-day history is not a repeat but appliedAt always blocks despite NEW status", () => {
  const result = filterRecommendationPayload({ run_date: "2026-10-15", jobs: [listing(), listing("https://job-boards.greenhouse.io/example/jobs/456")] }, snapshot([
    historyJob({ recommended_run_dates: ["2026-10-15"] }),
    historyJob({ job_id: "job-b", source_url: "https://job-boards.greenhouse.io/example/jobs/456", applied_at: "2026-10-01T00:00:00.000Z" }),
  ]), now);
  assert.equal(result.payload.jobs.length, 1);
  assert.equal(result.suppressions[0].reason, "already_applied_or_in_pipeline");
});

test("repeat filtering requires source-backed evidence and allows an empty shortlist", () => {
  const result = filterRecommendationPayload({ run_date: "2026-10-15", jobs: [listing()] }, snapshot([historyJob({ recommended_run_dates: ["2026-10-14"] })]), now);
  assert.deepEqual(result.payload.jobs, []);
  assert.equal(result.suppressions[0].reason, "repeat_missing_evidence");
});

test("normalized custom URLs match tracking and fallback does not combine distinct live IDs", () => {
  const custom = "https://careers.example.com/data?role=123";
  assert.equal(findMatchingHistory(listing(`${custom}&utm_source=feed#apply`), [historyJob({ source_url: custom })]).matches.length, 1);
  const distinct = findMatchingHistory(listing("https://job-boards.greenhouse.io/example/jobs/456"), [historyJob()]);
  assert.deepEqual(distinct.matches, []);
  const unknownAlias = historyJob({ job_id: "no-url", source_url: null, status: "APPLIED" });
  assert.equal(findMatchingHistory(listing(), [historyJob(), unknownAlias]).matches.length, 2);
  assert.equal(findMatchingHistory(listing(), [historyJob(), unknownAlias, historyJob({ job_id: "other", source_url: "https://job-boards.greenhouse.io/example/jobs/456" })]).matches.length, 1);
});

test("qualified recent repeats fill remaining places after new jobs and aliases stay deduplicated", () => {
  const repeat = { ...listing(), repeat_reason: "Employer now confirms remote eligibility for this location", repeat_evidence_url: "https://careers.example.com/update" };
  const newJobs = [456, 789, 1011].map((id) => listing(`https://job-boards.greenhouse.io/example/jobs/${id}`));
  const history = snapshot([historyJob({ recommended_run_dates: ["2026-10-14"] })]);
  const result = filterRecommendationPayload({ run_date: "2026-10-15", jobs: [repeat, ...newJobs] }, history, now);
  assert.deepEqual(result.payload.jobs, [...newJobs, repeat]);
  const deduplicated = filterRecommendationPayload({ run_date: "2026-10-15", jobs: [repeat, newJobs[0], { ...newJobs[0], source_url: "https://example.com/job?gh_jid=456" }, newJobs[1]] }, history, now);
  assert.deepEqual(deduplicated.payload.jobs, [newJobs[0], newJobs[1], repeat]);
  assert.deepEqual(deduplicated.suppressions.map((item) => item.reason), ["duplicate_in_payload"]);
});

test("overflow reports the ten-job target rather than an obsolete repeat quota", () => {
  const jobs = Array.from({ length: 11 }, (_, index) => listing(`https://job-boards.greenhouse.io/example/jobs/${index + 1}`));
  const result = filterRecommendationPayload({ run_date: "2026-10-15", jobs }, snapshot(), now);
  assert.equal(result.payload.jobs.length, 10);
  assert.equal(result.suppressions[0].reason, "shortlist_limit");
});

test("filter validates its input before producing an eligible payload", () => {
  assert.throws(() => filterRecommendationPayload({ run_date: "2026-02-30", jobs: [] }, snapshot(), now));
  assert.throws(() => filterRecommendationPayload({ run_date: "2026-10-15", jobs: [{ ...listing(), title: "" }] }, snapshot(), now));
});
