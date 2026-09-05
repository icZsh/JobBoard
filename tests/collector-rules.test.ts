import assert from "node:assert/strict";
import test from "node:test";
import { defaultRules, parseConfig } from "../src/lib/collector/config";
import { evaluatePosting, toImportJob } from "../src/lib/collector/rules";
import type { CollectorPosting } from "../src/lib/collector/types";
import { importPayloadSchema } from "../src/lib/import/validation";
import { isApplyTodayJob } from "../src/lib/jobs/prioritization";

const runDate = "2026-09-05";
const fetchedAt = "2026-09-05T12:00:00.000Z";

function posting(changes: Partial<CollectorPosting> = {}): CollectorPosting {
  return {
    provider: "ashby", board: "example", externalId: "123", company: "Example",
    companyWebsiteUrl: "https://example.com", title: "Data Engineer",
    locations: ["Remote - United States"], country: "US", remoteType: "remote",
    employmentType: "FullTime", description: "Required qualifications:\n3+ years of experience in data engineering.\nPython, SQL, Spark and Airflow.",
    sourceUrl: "https://jobs.ashbyhq.com/example/123", salaryMin: 160000,
    salaryMax: 190000, datePosted: "2026-09-03", dateEvidence: "first_published",
    sourceUpdatedAt: null, warnings: [], ...changes,
  };
}

function evaluate(changes: Partial<CollectorPosting> = {}) {
  return evaluatePosting(posting(changes), defaultRules, runDate);
}

test("accepts relevant mid-level titles and excludes seniority, contracts and unrelated software", () => {
  for (const title of ["Data Engineer II", "Analytics Engineer", "BI Developer", "Software Engineer, Data Infrastructure", "Data Infrastructure Engineer", "Data Platform Engineer", "ML Platform Engineer"]) {
    assert.equal(evaluate({ title }).included, true, title);
  }
  for (const title of ["Senior Data Engineer", "Sr. Data Engineer", "Staff Analytics Engineer", "Lead Data Engineer", "Data Engineering Manager", "Data Engineer Intern", "Data Engineer - New Grad", "Data Engineer (Contract)", "Junior Data Engineer", "Software Engineer, Frontend", "Sales Analyst", "Data Analyst", "BI Analyst", "Product Designer, Data Platform"]) {
    assert.equal(evaluate({ title }).included, false, title);
  }
  assert.equal(evaluate({ employmentType: "Contract" }).included, false);
  assert.equal(evaluate({ description: "Required: 3 years of experience. You will collaborate with senior engineers." }).included, true);
});

test("accepts NYC, SF Bay, and proven US remote eligibility, with location boundaries", () => {
  for (const location of ["New York, NY", "New York City", "San Francisco, CA", "San Francisco Bay Area", "Mountain View, CA", "Remote - US", "USA (Remote)"]) {
    assert.equal(evaluate({ locations: [location], country: null, remoteType: null }).included, true, location);
  }
  assert.equal(evaluate({ locations: ["Remote"], country: "United States", remoteType: "remote" }).included, true);
  assert.equal(evaluate({ locations: ["Remote"], country: null, description: "This role is remote within the United States. Required: 3 years of experience." }).included, true);
  assert.equal(evaluate({ locations: ["London", "New York, NY"], country: null, remoteType: "hybrid" }).included, true);
  for (const location of ["Remote", "Remote - Canada", "Remote - India", "Remote - North America", "Yorkshire", "New York Mills", "New York State", "San Francisco, Philippines", "Tampa Bay Area", "London"]) {
    const decision = evaluate({ locations: [location], country: null });
    assert.equal(decision.included, false, location);
    assert.match(decision.reasons.join(" "), /location/i);
  }
  assert.equal(evaluate({ locations: ["Remote"], country: "CA", description: "We are headquartered in San Francisco and have colleagues in the United States." }).included, false);
  assert.equal(evaluate({ locations: ["Remote"], country: null, description: "Come work with us remotely. Required: 3 years of experience." }).included, false);
  assert.equal(evaluate({ locations: ["Remote - Canada"], country: "US" }).included, false);
  assert.equal(evaluate({ locations: ["US"], country: null, remoteType: "remote" }).included, true);
  assert.equal(evaluate({ locations: ["Remote - US / Canada"], country: null, remoteType: "remote" }).included, true);
  assert.equal(evaluatePosting(posting({ locations: ["Remote"] }), { ...defaultRules, usRemotePatterns: [] }, runDate).included, false);
});

test("uses explicit required experience, respects preferences and alternative paths", () => {
  assert.equal(evaluate({ description: "Required qualifications:\n6+ years of professional experience with SQL." }).included, false);
  assert.equal(evaluate({ description: "You must have at least 6 years of experience building data systems." }).included, false);
  for (const description of ["Requires 7 years of experience.", "What You'll Need\n7+ years of experience in data engineering.", "You Have\n7+ years of experience.", "Required: six years of professional experience.", "Required: 6 or more years of experience."]) {
    assert.equal(evaluate({ description }).included, false, description);
  }
  const boundary = evaluate({ description: "Minimum qualifications: 5+ years of experience." });
  assert.equal(boundary.included, true);
  assert.match(boundary.concerns.join(" "), /5.*boundary/i);
  for (const description of [
    "Required: 3 years of experience. Preferred: 8 years of experience.",
    "Required qualifications:\n3 years of experience.\nNice to have:\n8+ years of experience.",
    "Required: 3 years of experience. Bonus points for 7 years of experience with Python.",
    "Minimum qualifications: 6 years of experience with a bachelor's degree or 3 years of experience with a master's degree.",
    "Required: 3 years of experience. Benefits: bonus paid after 7 years of service.",
    "Required: 3 years of experience. 10 years in business and 8 offices worldwide.",
  ]) assert.equal(evaluate({ description }).included, true, description);
  const ambiguous = evaluate({ description: "The team has 10 years of experience with data systems." });
  assert.equal(ambiguous.included, true);
  assert.match(ambiguous.concerns.join(" "), /experience.*unverified|experience.*unclear/i);
});

test("keeps unknown dates unknown, applies freshness boundaries and labels repost or future dates", () => {
  const unknown = evaluate({ datePosted: null, sourceUpdatedAt: fetchedAt, dateEvidence: "unknown" });
  assert.equal(unknown.included, true);
  assert.match(unknown.concerns.join(" "), /posting date.*unknown/i);
  assert.equal(evaluatePosting(posting({ datePosted: null }), { ...defaultRules, allowUnknownDate: false }, runDate).included, false);
  assert.equal(evaluate({ datePosted: "2026-08-06" }).included, true);
  assert.equal(evaluate({ datePosted: "2026-08-05" }).included, false);
  assert.match(evaluate({ datePosted: "2026-09-06" }).concerns.join(" "), /future/i);
  assert.match(evaluate({ dateEvidence: "last_published" }).concerns.join(" "), /repost|last publication/i);
  assert.match(evaluate({ dateEvidence: "created" }).concerns.join(" "), /creation|created/i);
  assert.match(evaluate({ datePosted: "2026-02-30" }).concerns.join(" "), /date.*invalid|date.*unknown/i);
  assert.throws(() => evaluatePosting(posting(), defaultRules, "not-a-date"), /run date/i);
});

test("salary is preferential, keyword boundaries are exact, and scores explain only rules", () => {
  const matched = evaluate();
  const unknown = evaluate({ salaryMin: null, salaryMax: null });
  const low = evaluate({ salaryMin: 100000, salaryMax: 130000 });
  assert.equal(low.included, true);
  assert.ok(matched.score > unknown.score && unknown.score > low.score);
  assert.match(unknown.concerns.join(" "), /salary.*unknown/i);
  assert.match(low.concerns.join(" "), /salary.*160,000/i);
  const skills = evaluate({ description: "Required: 3 years of experience. MySQL, PostgreSQL, JavaScript, Apache Hive, sparkles, SQL, AWS, BigQuery, dbt." });
  assert.deepEqual(skills.matchedSkills, ["SQL", "Hive", "dbt", "BigQuery", "AWS"]);
  assert.equal(skills.matchedSkills.includes("Spark"), false);
  assert.match(skills.reasons.join(" "), /\+\d+.*(?:title|location|skills)/i);
  assert.ok(skills.score >= 0 && skills.score <= 100);
});

test("writes importer-compatible evidence without inferring benefits or missing candidate skills", () => {
  const source = posting({ datePosted: null, dateEvidence: "unknown", warnings: ["Provider compensation caveat"] });
  const decision = evaluatePosting(source, defaultRules, runDate);
  const job = toImportJob(source, decision, fetchedAt);
  assert.equal(importPayloadSchema.safeParse({ run_date: runDate, source_name: "ats_collector_rules_v1", jobs: [job] }).success, true);
  assert.equal(job.date_posted, null);
  assert.deepEqual(job.missing_skills, []);
  assert.match(job.description, /^Company: Example\n\nBenefits: Not independently verified/);
  assert.ok(job.description.endsWith(`Role: ${source.description}`));
  assert.match(job.match_reason, /rules-v1/i);
  assert.doesNotMatch(job.match_reason, /resume|AI analysis/i);
  assert.match(job.concerns ?? "", /Provider compensation caveat/);
  assert.equal(job.collector.fetched_at, fetchedAt);
  assert.equal(job.collector.date_evidence, "unknown");
  assert.equal(job.suggested_action, "Review today.");
  assert.equal(isApplyTodayJob({ fitScore: job.fit_score, concerns: job.concerns, status: "NEW", suggestedAction: job.suggested_action, highFitThreshold: 80 }), false);
  assert.throws(() => toImportJob(source, { ...decision, included: false }, fetchedAt), /excluded/i);
});

test("configuration fills defaults and rejects invalid, unknown, or duplicate values", () => {
  const sources = [{ provider: "ashby", board: "example", company: "Example" }];
  const config = parseConfig({ version: 1, sources, rules: { maxResults: 3 }, request: { retries: 0 } });
  assert.equal(config.rules.maxResults, 3);
  assert.equal(config.rules.maxExperienceYears, 5);
  assert.equal(config.sources[0].enabled, true);
  assert.equal(config.sources[0].websiteUrl, null);
  assert.equal(config.request.retries, 0);
  assert.throws(() => parseConfig({ version: 1, sources, rules: { locationPatterns: ["["] } }));
  assert.throws(() => parseConfig({ version: 1, sources, rules: { maxResults: 0 } }));
  assert.throws(() => parseConfig({ version: 1, sources, rules: { allowUnkownDate: true } }));
  assert.throws(() => parseConfig({ version: 1, sources: [...sources, ...sources] }), /duplicate/i);
  assert.throws(() => parseConfig({ version: 1, sources: [{ ...sources[0], board: "../../other" }] }));
  assert.throws(() => parseConfig({ version: 1, sources, request: { concurrency: 100 } }));
});
