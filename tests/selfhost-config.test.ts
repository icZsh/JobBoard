import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSelfHostConfig,
  parseSelfHostConfig,
  parseSelfHostInput,
  sourceFromAtsUrl,
  atsUrlForSource,
} from "../src/lib/selfhost/config";
import { evaluatePosting } from "../src/lib/collector/rules";
import type { CollectorPosting } from "../src/lib/collector/types";

function input() {
  const config = defaultSelfHostConfig();
  return {
    timezone: config.timezone,
    schedule: config.schedule,
    preferences: config.preferences,
    sources: config.collector.sources.map((source) => ({
      company: source.company,
      atsUrl: atsUrlForSource(source),
      enabled: source.enabled,
    })),
  };
}

test("self-host defaults provide 18 editable company boards and round-trip validated snapshots", () => {
  const config = parseSelfHostInput(input());
  assert.equal(config.collector.sources.length, 18);
  assert.deepEqual(
    parseSelfHostConfig(JSON.parse(JSON.stringify(config))),
    config,
  );
  assert.equal(config.collector.rules.minExperienceYears, 2);
  assert.equal(
    config.collector.rules.maxResults,
    config.preferences.maxResults,
  );
});

test("ATS company URLs cannot address arbitrary hosts, credentials, ports, or encoded board paths", () => {
  for (const [url, provider] of [
    ["https://jobs.ashbyhq.com/example/", "ashby"],
    ["https://job-boards.greenhouse.io/example", "greenhouse"],
    ["https://boards.greenhouse.io/example", "greenhouse"],
    ["https://jobs.lever.co/example", "lever"],
  ])
    assert.equal(sourceFromAtsUrl(url, "Example").provider, provider);
  for (const url of [
    "http://jobs.lever.co/example",
    "https://jobs.lever.co.evil.example/example",
    "https://jobs.lever.co@evil.example/example",
    "https://user:secret@jobs.lever.co/example",
    "https://jobs.lever.co:8443/example",
    "https://jobs.lever.co/example?redirect=http://localhost",
    "https://jobs.lever.co/example#private",
    "https://jobs.lever.co/%2fetc",
    "https://jobs.lever.co/example/id",
    "https://127.0.0.1/example",
  ])
    assert.throws(() => sourceFromAtsUrl(url, "Example"), url);
});

test("normal user preferences compile as escaped literals with no regex input or collector override", () => {
  const value = input();
  value.preferences.roles = ["Data Engineer (.*)"];
  const config = parseSelfHostInput(value);
  const pattern = new RegExp(
    config.collector.rules.includeTitlePatterns[0],
    "iu",
  );
  assert.equal(pattern.test("Data Engineer Analytics"), false);
  assert.throws(() =>
    parseSelfHostInput({
      ...input(),
      collector: { request: { timeoutMs: 1 } },
    }),
  );
  const saved = defaultSelfHostConfig();
  saved.collector.rules.includeTitlePatterns = [".*"];
  assert.deepEqual(
    parseSelfHostConfig(saved).collector.rules.includeTitlePatterns,
    [".*"],
    "Queued snapshots retain their validated rules across later code/default changes.",
  );
});

test("config rejects contradictory experience, invalid scheduling, duplicate or entirely disabled sources", () => {
  const value = input();
  assert.throws(() =>
    parseSelfHostInput({ ...value, timezone: "Mars/Olympus" }),
  );
  assert.throws(() =>
    parseSelfHostInput({
      ...value,
      schedule: { enabled: true, time: "24:00" },
    }),
  );
  assert.throws(() =>
    parseSelfHostInput({
      ...value,
      preferences: {
        ...value.preferences,
        minExperienceYears: 6,
        maxExperienceYears: 3,
      },
    }),
  );
  assert.throws(() =>
    parseSelfHostInput({
      ...value,
      preferences: { ...value.preferences, cities: [], usRemote: false },
    }),
  );
  assert.throws(() =>
    parseSelfHostInput({
      ...value,
      sources: [value.sources[0], value.sources[0]],
    }),
  );
  assert.throws(() =>
    parseSelfHostInput({
      ...value,
      sources: value.sources.map((source) => ({ ...source, enabled: false })),
    }),
  );
});

test("experience preference actually changes deterministic scoring without inventing unknown years", () => {
  const rules = defaultSelfHostConfig().collector.rules;
  const posting: CollectorPosting = {
    provider: "ashby",
    board: "test",
    externalId: "one",
    company: "Test",
    companyWebsiteUrl: null,
    title: "Data Engineer",
    locations: ["New York, NY"],
    country: "US",
    remoteType: "onsite",
    employmentType: "FullTime",
    description: "Required: 3 years of experience. Python and SQL.",
    sourceUrl: "https://jobs.ashbyhq.com/test/one",
    salaryMin: null,
    salaryMax: null,
    datePosted: null,
    dateEvidence: "unknown",
    sourceUpdatedAt: null,
    warnings: [],
  };
  const usual = evaluatePosting(posting, rules, "2026-09-05");
  const higher = evaluatePosting(
    posting,
    { ...rules, minExperienceYears: 4 },
    "2026-09-05",
  );
  assert.ok(usual.score > higher.score);
  assert.match(higher.reasons.join(" "), /configured 4 year/);
  assert.equal(
    evaluatePosting(
      { ...posting, description: "Python and SQL." },
      { ...rules, minExperienceYears: 4 },
      "2026-09-05",
    ).included,
    true,
  );
});
