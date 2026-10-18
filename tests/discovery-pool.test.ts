import assert from "node:assert/strict";
import test from "node:test";
import { parsePool, updatePool } from "../src/lib/discovery/pool";
import type { DiscoveryPosting, SourceScanResult } from "../src/lib/discovery/types";
import type { RecommendationHistory, RecommendationHistoryJob } from "../src/lib/jobs/recommendation-history";

const now = new Date("2026-10-16T08:00:00.000Z");

function posting(id = "123", fields: Partial<DiscoveryPosting> = {}): DiscoveryPosting {
  return {
    key: `greenhouse:${id}`, source_id: "greenhouse:example", provider: "greenhouse",
    external_id: id, company: "Example", title: "Data Engineer", location: "San Francisco, CA",
    source_url: `https://job-boards.greenhouse.io/example/jobs/${id}`,
    description: "Requirements: 2–4 years of professional experience. Build Python and SQL pipelines with senior engineers.",
    employment_type: "FullTime", workplace_type: "Hybrid", published_at: "2026-09-01T00:00:00.000Z",
    published_at_kind: "last_published", ...fields,
  };
}

function scan(postings: DiscoveryPosting[], fields: Partial<SourceScanResult> = {}): SourceScanResult {
  return { source_id: "greenhouse:example", success: true, postings, total_count: postings.length, ...fields };
}

function history(jobs: RecommendationHistoryJob[] = [], time = now): RecommendationHistory {
  return { schema_version: 1, generated_at: time.toISOString(), jobs };
}

function historyJob(fields: Partial<RecommendationHistoryJob> = {}): RecommendationHistoryJob {
  return {
    job_id: "existing", company: "Example", title: "Data Engineer", location: "San Francisco, CA",
    source_url: posting().source_url, status: "NEW", applied_at: null, recommended_run_dates: ["2026-10-15"], ...fields,
  };
}

test("queue requires a valid current sanitized history even for an empty scan", () => {
  assert.throws(() => updatePool(null, [], undefined as unknown as RecommendationHistory, now));
  assert.throws(() => updatePool(null, [], history([], new Date("2026-10-15T07:59:59.999Z")), now), /stale/i);
  assert.throws(() => updatePool(null, [], { ...history(), notes: "private" } as RecommendationHistory, now));
  assert.throws(() => updatePool(null, [], history([], new Date("2026-10-16T08:00:01.000Z")), now), /future/i);
});

test("retains first discovery across scans and republishing never invents a new posting", () => {
  const first = updatePool(null, [scan([posting()])], history(), now);
  const nextDay = new Date("2026-10-17T08:00:00.000Z");
  const refreshed = posting("123", { published_at: nextDay.toISOString(), source_url: `${posting().source_url}?utm_source=refresh` });
  const second = updatePool(first.pool, [scan([refreshed])], history([], nextDay), nextDay);
  assert.equal(second.pool.postings.length, 1);
  assert.equal(second.pool.postings[0].first_seen_at, now.toISOString());
  assert.equal(second.pool.postings[0].last_seen_at, nextDay.toISOString());
  assert.equal(second.metrics.first_discovered, 0);
  assert.equal(first.metrics.first_discovered, 1);
  assert.equal(second.queue.candidates[0].previously_recommended, false);
  assert.equal(second.queue.candidates[0].published_at_kind, "last_published");
  assert.equal(second.queue.candidates[0].description, refreshed.description);
  assert.deepEqual(first.pool.postings[0].source_url, posting().source_url);
});

test("a temporary unrelated title cannot reset an existing posting's first discovery", () => {
  const first = updatePool(null, [scan([posting()])], history(), now);
  const changedTime = new Date("2026-10-16T09:00:00.000Z");
  const changed = updatePool(first.pool, [scan([posting("123", { title: "Technical Specialist" })])], history([], changedTime), changedTime);
  assert.equal(changed.pool.postings.length, 1);
  assert.equal(changed.queue.candidates.length, 0);
  assert.equal(changed.pool.postings[0].title, "Technical Specialist");
  assert.equal(changed.metrics.exclusion_reasons.unrelated_role, 1);
  const returnTime = new Date("2026-10-17T09:00:00.000Z");
  const returned = updatePool(changed.pool, [scan([posting()])], history([], returnTime), returnTime);
  assert.equal(returned.pool.postings[0].first_seen_at, now.toISOString());
  assert.equal(returned.metrics.first_discovered, 0);
});

test("a successful omission marks missing while a failed feed remains unverified and produces no candidates", () => {
  const first = updatePool(null, [scan([posting()])], history(), now);
  const later = new Date("2026-10-16T09:00:00.000Z");
  const failure = updatePool(first.pool, [scan([], { success: false, error: "timeout" })], history([], later), later);
  assert.equal(failure.pool.postings[0].availability, "unverified");
  assert.equal(failure.pool.postings[0].last_seen_at, now.toISOString());
  assert.equal(failure.pool.postings[0].last_checked_at, later.toISOString());
  assert.equal(failure.queue.candidates.length, 0);
  assert.ok(failure.queue.review_holds[0].screening.reasons.includes("source_unverified"));
  const missing = updatePool(first.pool, [scan([])], history([], later), later);
  assert.equal(missing.pool.postings[0].availability, "missing");
  assert.equal(missing.queue.candidates.length, 0);
  assert.equal(missing.metrics.exclusion_reasons.source_missing, 1);
  const retry = updatePool(failure.pool, [scan([posting()])], history([], later), later);
  assert.equal(retry.pool.postings[0].availability, "active");
  assert.equal(retry.queue.candidates.length, 1);
});

test("failed partial results neither introduce new postings nor refresh old ones", () => {
  const first = updatePool(null, [scan([posting()])], history(), now);
  const later = new Date("2026-10-16T10:00:00.000Z");
  const result = updatePool(first.pool, [scan([posting("456")], { success: false, total_count: 50 })], history([], later), later);
  assert.deepEqual(result.pool.postings.map((entry) => entry.external_id), ["123"]);
  assert.equal(result.queue.candidates.length, 0);
  assert.equal(result.metrics.first_discovered, 0);
});

test("cache re-screens tracking without changing scan times; older than 24 hours is held", () => {
  const first = updatePool(null, [scan([posting()])], history(), now);
  const later = new Date("2026-10-16T12:00:00.000Z");
  const cached = updatePool(first.pool, [], history([], later), later);
  assert.equal(cached.queue.candidates.length, 1);
  assert.equal(cached.pool.postings[0].last_seen_at, now.toISOString());
  assert.equal(cached.pool.postings[0].last_checked_at, now.toISOString());
  const staleTime = new Date("2026-10-17T08:00:00.001Z");
  const stale = updatePool(first.pool, [], history([], staleTime), staleTime);
  assert.equal(stale.queue.candidates.length, 0);
  assert.ok(stale.queue.review_holds[0].screening.reasons.includes("source_stale"));
  const applied = updatePool(first.pool, [], history([historyJob({ status: "APPLIED" })], later), later);
  assert.equal(applied.queue.candidates.length, 0);
  assert.equal(applied.metrics.exclusion_reasons.already_applied_or_in_pipeline, 1);
});

test("URL aliases aggregate application and closed status without mutating history", () => {
  const snapshot = history([
    historyJob(), historyJob({ job_id: "alias", source_url: "https://example.com/careers?gh_jid=123&utm_source=mail", status: "APPLIED" }),
    historyJob({ job_id: "passed", source_url: posting("456").source_url, status: "PASSED" }),
    historyJob({ job_id: "date", source_url: posting("789").source_url, applied_at: "2026-10-01T00:00:00.000Z" }),
  ]);
  const before = JSON.stringify(snapshot);
  const result = updatePool(null, [scan([posting(), posting("456"), posting("789"), posting("999")])], snapshot, now);
  assert.deepEqual(result.queue.candidates.map((entry) => entry.external_id), ["999"]);
  assert.equal(result.metrics.exclusion_reasons.already_applied_or_in_pipeline, 2);
  assert.equal(result.metrics.exclusion_reasons.closed_or_dismissed, 1);
  assert.equal(JSON.stringify(snapshot), before);
});

test("Lever application URLs and source tags match applied posting UUIDs", () => {
  const uuid = "2c50ea23-6811-4cc4-99a3-67627d45c6ae";
  const lever = posting(uuid, { key: `lever:${uuid}`, provider: "lever", source_id: "lever:example", source_url: `https://jobs.lever.co/example/${uuid}` });
  for (const suffix of ["/apply", "?lever-source=LinkedIn", "/apply?lever-source=LinkedIn"]) {
    const result = updatePool(null, [scan([lever], { source_id: lever.source_id })], history([
      historyJob({ source_url: `${lever.source_url}${suffix}`, status: "APPLIED" }),
    ]), now);
    assert.equal(result.queue.candidates.length, 0, suffix);
    assert.equal(result.metrics.exclusion_reasons.already_applied_or_in_pipeline, 1);
  }
});

test("new-to-history candidates precede repeats, include same-day history, and are never truncated to ten", () => {
  const all = Array.from({ length: 14 }, (_, index) => posting(String(index + 123)));
  const result = updatePool(null, [scan(all)], history([
    historyJob(), historyJob({ job_id: "today", source_url: posting("124").source_url, recommended_run_dates: ["2026-10-16"] }),
  ]), now);
  assert.equal(result.queue.candidates.length, 14);
  assert.deepEqual(result.queue.candidates.slice(-2).map((entry) => entry.external_id), ["123", "124"]);
  assert.equal(result.metrics.new_recommendation_candidates, 12);
  assert.equal(result.metrics.repeat_candidates, 2);
  assert.equal(result.queue.candidates.at(-1)?.previously_recommended, true);
  assert.equal(result.queue.candidates[0].screening.status, "candidate");
  assert.equal("fit_score" in result.queue.candidates[0], false);
});

test("supports data/analytics/streaming/ML infrastructure/BI aliases and holds broad software roles", () => {
  const titles = ["Data Platform Engineer", "Analytics Engineer", "Streaming Engineer", "Machine Learning Infrastructure Engineer", "Business Intelligence Engineer", "Software Engineer, Data Infrastructure", "Software Engineer"];
  const result = updatePool(null, [scan(titles.map((title, index) => posting(String(index), { title })))], history(), now);
  assert.equal(result.pool.postings.length, 7);
  assert.equal(result.queue.candidates.length, 6);
  assert.equal(result.queue.review_holds.length, 1);
  assert.ok(result.queue.review_holds[0].screening.reasons.includes("role_specialism_unclear"));
});

test("discards unrelated non-engineering roles and screens seniority only in the title", () => {
  const titles = ["Data Engineer", "Senior Data Engineer", "Staff Software Engineer, Data", "Principal Engineer", "Lead Analytics Engineer", "Engineering Manager", "Data Engineer Intern", "Data Engineer - New Grad", "Data Analyst", "Account Executive", "Data Engineer (Contract)"];
  const result = updatePool(null, [scan(titles.map((title, index) => posting(String(index), { title })))], history(), now);
  assert.deepEqual(result.queue.candidates.map((entry) => entry.title), ["Data Engineer"]);
  assert.ok(!result.pool.postings.some((entry) => ["Data Analyst", "Account Executive"].includes(entry.title)));
  assert.equal(result.metrics.raw_retrieved, titles.length);
  assert.equal(result.metrics.relevant_retrieved, 9);
  assert.equal(result.metrics.exclusion_reasons.unrelated_role, 2);
  assert.equal(result.metrics.exclusion_reasons.unsupported_seniority, 5);
});

test("explicit US remote and target cities pass while India remote and wrong cities do not", () => {
  const locations = ["United States - Remote", "Remote, US", "New York, NY", "San Francisco Bay Area", "Bengaluru, India (Remote)", "Remote - Canada", "Austin, TX", "Remote", "North America", "India / United States - Remote"];
  const result = updatePool(null, [scan(locations.map((location, index) => posting(String(index), { location, workplace_type: "Remote" })))], history(), now);
  assert.deepEqual(result.queue.candidates.map((entry) => entry.location).sort(), locations.slice(0, 4).sort());
  assert.equal(result.metrics.exclusion_reasons.unsupported_location, 3);
  assert.equal(result.queue.review_holds.length, 3);
  assert.ok(result.queue.review_holds.every((entry) => entry.screening.reasons.includes("location_unclear")));
});

test("missing or ambiguous years require review, explicit excessive requirements exclude, and senior colleagues do not", () => {
  const descriptions = [
    "Requirements: 2–4 years of professional experience. Work with senior engineers.",
    "Minimum of 3 years of software engineering experience.",
    "Build pipelines. Collaborate with senior staff.",
    "Minimum of 7 years of professional experience required.",
    "Our company has 10 years of experience helping customers. Build pipelines.",
    "Requirements: 3 years with Python, 5 years with Java, or equivalent relevant experience.",
  ];
  const result = updatePool(null, [scan(descriptions.map((description, index) => posting(String(index), { description })))], history(), now);
  assert.deepEqual(result.queue.candidates.map((entry) => entry.external_id), ["0", "1"]);
  assert.equal(result.queue.review_holds.length, 3);
  assert.equal(result.metrics.exclusion_reasons.experience_requirement_too_high, 1);
  assert.ok(result.queue.review_holds.every((entry) => entry.screening.reasons.includes("experience_unclear")));
});

test("higher experience floors are review holds and preferred experience does not override required experience", () => {
  const result = updatePool(null, [scan([
    posting("1", { description: "5+ years of professional experience." }),
    posting("2", { description: "2+ years of professional experience required; 5+ years preferred." }),
    posting("3", { description: "Minimum five years of professional experience." }),
  ])], history(), now);
  assert.deepEqual(result.queue.candidates.map((entry) => entry.external_id), ["2"]);
  assert.equal(result.queue.review_holds.find((entry) => entry.external_id === "1")?.screening.reasons.includes("experience_floor_review"), true);
  assert.equal(result.queue.review_holds.find((entry) => entry.external_id === "3")?.screening.reasons.includes("experience_unclear"), true);
  assert.equal(result.metrics.exclusion_reasons.experience_requirement_too_high, undefined);
});

test("parsePool validates persisted data, versions, duplicate identities and timestamps", () => {
  const result = updatePool(null, [scan([posting()])], history(), now);
  assert.deepEqual(parsePool(JSON.parse(JSON.stringify(result.pool))), result.pool);
  assert.throws(() => parsePool({ ...result.pool, schema_version: 2 }));
  assert.throws(() => parsePool({ ...result.pool, postings: [...result.pool.postings, result.pool.postings[0]] }), /duplicate/i);
  assert.throws(() => parsePool({ ...result.pool, postings: [{ ...result.pool.postings[0], last_seen_at: "not a date" }] }));
  assert.throws(() => parsePool({ ...result.pool, postings: [{ ...result.pool.postings[0], source_url: "javascript:bad()" }] }));
});

test("inconsistent or duplicate successful source scans fail closed instead of marking omissions", () => {
  assert.throws(() => updatePool(null, [scan([posting()], { total_count: 2 })], history(), now), /incomplete/i);
  assert.throws(() => updatePool(null, [scan([posting()]), scan([])], history(), now), /duplicate/i);
  assert.throws(() => updatePool(null, [scan([posting("123", { source_id: "other" })])], history(), now), /source/i);
});
