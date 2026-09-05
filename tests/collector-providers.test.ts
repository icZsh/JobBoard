import assert from "node:assert/strict";
import test from "node:test";
import { createJsonFetcher } from "../src/lib/collector/http";
import { fetchSource } from "../src/lib/collector/providers";
import type { CollectorSource, Provider } from "../src/lib/collector/types";

const source = (provider: Provider): CollectorSource => ({
  provider, board: "ExampleBoard", company: "Example", websiteUrl: "https://example.com", enabled: true,
});
const ashbyJob = (overrides = {}) => ({
  id: "a-1", title: "Data Analyst", isListed: true, location: "New York, NY",
  descriptionHtml: "<p>Use SQL &amp; Python.</p><script>ignore this</script><p>Health insurance.</p>",
  publishedAt: "2026-09-01T10:00:00Z", jobUrl: "https://jobs.ashbyhq.com/ExampleBoard/a-1",
  ...overrides,
});
const leverJob = (id = "l-1", overrides = {}) => ({
  id, text: "Data Analyst", categories: { location: "New York, NY", allLocations: ["New York, NY", "US Remote"], commitment: "Full-time" },
  descriptionPlain: "Use SQL.", lists: [{ text: "Requirements", content: "<li>Python</li><li>dbt</li>" }],
  additionalPlain: "Health insurance.", hostedUrl: `https://jobs.lever.co/ExampleBoard/${id}`, country: "US",
  ...overrides,
});
const greenhouseJob = (overrides = {}) => ({
  id: 123, title: "Data Analyst", location: { name: "New York, NY" },
  content: "&lt;p&gt;Use SQL &amp;amp; Python.&lt;/p&gt;", updated_at: "2026-09-02T10:00:00Z",
  absolute_url: "https://boards.greenhouse.io/ExampleBoard/jobs/123", ...overrides,
});
const component = (overrides = {}) => ({
  compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 100000, maxValue: 130000,
  ...overrides,
});

test("Ashby includes only listed jobs and keeps publication semantics, locations and plaintext", async () => {
  const urls: string[] = [];
  const jobs = await fetchSource(source("ashby"), async (url) => {
    urls.push(url);
    return { jobs: [ashbyJob({ workplaceType: "Hybrid", secondaryLocations: [{ location: "San Francisco, CA" }], address: { postalAddress: { addressCountry: "USA" } } }), ashbyJob({ id: "hidden", isListed: false })] };
  });
  assert.deepEqual(urls, ["https://api.ashbyhq.com/posting-api/job-board/ExampleBoard?includeCompensation=true"]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].board, "ExampleBoard");
  assert.equal(jobs[0].externalId, "a-1");
  assert.equal(jobs[0].remoteType, "hybrid");
  assert.equal(jobs[0].country, "USA");
  assert.deepEqual(jobs[0].locations, ["New York, NY", "San Francisco, CA"]);
  assert.equal(jobs[0].description, "Use SQL & Python.\nHealth insurance.");
  assert.equal(jobs[0].datePosted, "2026-09-01");
  assert.equal(jobs[0].dateEvidence, "last_published");
  assert.equal(jobs[0].sourceUpdatedAt, null);
});

test("Ashby documented URL identity works when id is absent", async () => {
  const [job] = await fetchSource(source("ashby"), async () => ({ jobs: [ashbyJob({ id: undefined })] }));
  assert.equal(job.externalId, "a-1");
});

test("Ashby and Lever prefer official apply URLs without changing stable posting identity", async () => {
  const ashbyApplyUrl = "https://jobs.ashbyhq.com/ExampleBoard/a-1/application";
  const [ashby] = await fetchSource(source("ashby"), async () => ({ jobs: [ashbyJob({ id: undefined, applyUrl: ashbyApplyUrl })] }));
  assert.equal(ashby.sourceUrl, ashbyApplyUrl);
  assert.equal(ashby.externalId, "a-1");
  const leverApplyUrl = "https://jobs.lever.co/ExampleBoard/l-1/apply";
  const [lever] = await fetchSource(source("lever"), async () => [leverJob("l-1", { applyUrl: leverApplyUrl })]);
  assert.equal(lever.sourceUrl, leverApplyUrl);
  assert.equal(lever.externalId, "l-1");
});

test("missing official apply URLs fall back to the provided posting URLs", async () => {
  const [ashby] = await fetchSource(source("ashby"), async () => ({ jobs: [ashbyJob({ applyUrl: null })] }));
  assert.equal(ashby.sourceUrl, "https://jobs.ashbyhq.com/ExampleBoard/a-1");
  const [lever] = await fetchSource(source("lever"), async () => [leverJob()]);
  assert.equal(lever.sourceUrl, "https://jobs.lever.co/ExampleBoard/l-1");
});

test("Ashby accepts a single annual USD salary tier and ignores separate bonus/equity", async () => {
  const [job] = await fetchSource(source("ashby"), async () => ({ jobs: [ashbyJob({ compensation: {
    compensationTiers: [{ components: [component(), component({ compensationType: "Bonus", minValue: 10000, maxValue: 20000 })] }],
    summaryComponents: [component()],
  } })] }));
  assert.equal(job.salaryMin, 100000);
  assert.equal(job.salaryMax, 130000);
});

test("Ashby never mixes hourly, foreign currency, or multiple geographic salary tiers", async () => {
  const cases = [
    { compensationTiers: [{ components: [component({ interval: "1 HOUR" })] }] },
    { compensationTiers: [{ components: [component({ currencyCode: "CAD" })] }] },
    { compensationTiers: [{ components: [component()] }, { components: [component({ minValue: 80000, maxValue: 90000 })] }], summaryComponents: [component()] },
    { summaryComponents: [component({ minValue: 200000, maxValue: 100000 })] },
  ];
  for (const compensation of cases) {
    const [job] = await fetchSource(source("ashby"), async () => ({ jobs: [ashbyJob({ compensation })] }));
    assert.equal(job.salaryMin, null);
    assert.equal(job.salaryMax, null);
    assert.ok(job.warnings.some((warning) => /salary/i.test(warning)));
  }
});

test("provider salaries leave fractional and unsafe integers unknown so the combined import remains valid", async () => {
  for (const [min, max] of [[100000.5, 130000], [100000, 130000.5], [100000, Number.MAX_SAFE_INTEGER + 1]]) {
    const [ashby] = await fetchSource(source("ashby"), async () => ({ jobs: [ashbyJob({
      compensation: { summaryComponents: [component({ minValue: min, maxValue: max })] },
    })] }));
    const [lever] = await fetchSource(source("lever"), async () => [leverJob("l-1", {
      salaryDescriptionPlain: "Annual base salary",
      salaryRange: { currency: "USD", interval: "per-year-salary", min, max },
    })]);
    for (const job of [ashby, lever]) {
      assert.equal(job.salaryMin, null);
      assert.equal(job.salaryMax, null);
      assert.ok(job.warnings.some((warning) => /salary/i.test(warning)));
    }
  }
});

test("Greenhouse retains update date separately, prefers first_published when supplied, and decodes its HTML", async () => {
  const jobs = await fetchSource(source("greenhouse"), async (url) => {
    assert.equal(url, "https://boards-api.greenhouse.io/v1/boards/ExampleBoard/jobs?content=true");
    return { jobs: [greenhouseJob(), greenhouseJob({ id: 124, first_published: "2026-08-01T12:00:00Z" })], meta: { total: 2 } };
  });
  assert.equal(jobs[0].externalId, "123");
  assert.equal(jobs[0].datePosted, null);
  assert.equal(jobs[0].dateEvidence, "unknown");
  assert.equal(jobs[0].sourceUpdatedAt, "2026-09-02T10:00:00.000Z");
  assert.equal(jobs[0].description, "Use SQL & Python.");
  assert.equal(jobs[1].dateEvidence, "first_published");
  assert.equal(jobs[1].datePosted, "2026-08-01");
});

test("Greenhouse salary text is retained without guessing annual base salary", async () => {
  const [job] = await fetchSource(source("greenhouse"), async () => ({ jobs: [greenhouseJob({ content: "$80,000 - $120,000 total compensation" })] }));
  assert.equal(job.salaryMin, null);
  assert.equal(job.salaryMax, null);
});

test("Lever reads all pages, keeps every description section and labels creation dates", async () => {
  const skips: number[] = [];
  const jobs = await fetchSource(source("lever"), async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("mode"), "json");
    assert.equal(parsed.searchParams.get("limit"), "100");
    const skip = Number(parsed.searchParams.get("skip"));
    skips.push(skip);
    return skip === 0 ? Array.from({ length: 100 }, (_, i) => leverJob(String(i))) : [leverJob("last", { createdAt: 1788256800000, workplaceType: "remote", salaryDescriptionPlain: "Annual base salary", salaryRange: { currency: "USD", interval: "per-year-salary", min: 110000, max: 140000 } })];
  });
  assert.deepEqual(skips, [0, 100]);
  assert.equal(jobs.length, 101);
  assert.equal(jobs[100].datePosted, "2026-09-01");
  assert.equal(jobs[100].dateEvidence, "created");
  assert.equal(jobs[100].remoteType, "remote");
  assert.deepEqual(jobs[100].locations, ["New York, NY", "US Remote"]);
  assert.match(jobs[100].description, /Use SQL\.[\s\S]*Requirements[\s\S]*Python[\s\S]*dbt[\s\S]*Health insurance\.[\s\S]*Annual base salary/);
  assert.equal(jobs[100].salaryMin, 110000);
  assert.equal(jobs[100].salaryMax, 140000);
});

test("Lever checks the empty terminal page after an exact full page", async () => {
  let calls = 0;
  const jobs = await fetchSource(source("lever"), async () => ++calls === 1 ? Array.from({ length: 100 }, (_, i) => leverJob(String(i))) : []);
  assert.equal(calls, 2);
  assert.equal(jobs.length, 100);
});

test("Lever pagination errors and repeated IDs fail the whole source", async () => {
  for (const second of [null, [leverJob("0")], new Error("page unavailable")]) {
    let calls = 0;
    await assert.rejects(fetchSource(source("lever"), async () => {
      if (++calls === 1) return Array.from({ length: 100 }, (_, i) => leverJob(String(i)));
      if (second instanceof Error) throw second;
      return second;
    }));
  }
});

test("Lever excludes hourly/foreign/total/unlabeled salary ranges", async () => {
  const cases = [
    { currency: "USD", interval: "per-hour-wage", min: 50, max: 70 },
    { currency: "EUR", interval: "per-year-salary", min: 90000, max: 120000 },
    { currency: "USD", interval: "per-year-salary", min: 90000, max: 120000 },
  ];
  for (const salaryRange of cases) {
    const [job] = await fetchSource(source("lever"), async () => [leverJob("l-1", { salaryRange, salaryDescriptionPlain: "Total compensation including base salary and commission" })]);
    assert.equal(job.salaryMin, null);
    assert.equal(job.salaryMax, null);
    assert.ok(job.warnings.length);
  }
  const [job] = await fetchSource(source("lever"), async () => [leverJob("l-1", { salaryRange: cases[2] })]);
  assert.equal(job.salaryMin, null);
});

test("invalid/unknown provider dates remain null while future evidence is preserved", async () => {
  for (const publishedAt of [undefined, null, "invalid-date", "2026-02-30T10:00:00Z"]) {
    const [job] = await fetchSource(source("ashby"), async () => ({ jobs: [ashbyJob({ publishedAt })] }));
    assert.equal(job.datePosted, null);
    assert.equal(job.dateEvidence, "unknown");
  }
  const [future] = await fetchSource(source("ashby"), async () => ({ jobs: [ashbyJob({ publishedAt: "2099-01-01T00:00:00Z" })] }));
  assert.equal(future.datePosted, "2099-01-01");
});

test("malformed envelopes, required records, URLs, and completeness metadata fail source", async () => {
  const cases: Array<[Provider, unknown]> = [
    ["ashby", {}], ["ashby", { jobs: [ashbyJob({ isListed: undefined })] }],
    ["ashby", { jobs: [ashbyJob({ isListed: "true" })] }], ["ashby", { jobs: [ashbyJob({ title: "" })] }],
    ["ashby", { jobs: [ashbyJob({ jobUrl: "javascript:alert(1)" })] }],
    ["ashby", { jobs: [ashbyJob({ applyUrl: "javascript:alert(1)" })] }],
    ["greenhouse", { jobs: [greenhouseJob()], meta: { total: 2 } }],
    ["greenhouse", { jobs: [greenhouseJob({ content: null })] }],
    ["lever", { jobs: [] }], ["lever", [leverJob("l-1", { id: "" })]],
    ["lever", [leverJob("l-1", { applyUrl: "javascript:alert(1)" })]],
  ];
  for (const [provider, payload] of cases) await assert.rejects(fetchSource(source(provider), async () => payload), { name: /Error/ }, provider);
});

test("HTTP fetcher retries network/429/5xx reads, caps Retry-After and sends only GET", async () => {
  let calls = 0;
  const delays: number[] = [];
  const fetcher = createJsonFetcher({ timeoutMs: 1000, retries: 3, sleep: async (ms) => { delays.push(ms); }, fetchImpl: async (_url, options) => {
    assert.equal(options?.method, "GET");
    assert.ok(options?.signal);
    calls++;
    if (calls === 1) throw new TypeError("network disconnected");
    if (calls === 2) return new Response("", { status: 429, headers: { "Retry-After": "9999999" } });
    if (calls === 3) return new Response("", { status: 503 });
    return Response.json({ jobs: [] });
  } });
  assert.deepEqual(await fetcher("https://example.com/jobs"), { jobs: [] });
  assert.equal(calls, 4);
  assert.equal(delays.length, 3);
  assert.ok(delays.every((ms) => ms <= 5000 && ms >= 0));
});

test("HTTP errors and invalid JSON do not trigger indiscriminate retries", async () => {
  for (const response of [new Response("gone", { status: 404 }), new Response("not json", { status: 200 })]) {
    let calls = 0;
    const fetcher = createJsonFetcher({ timeoutMs: 1000, retries: 3, sleep: async () => {}, fetchImpl: async () => { calls++; return response; } });
    await assert.rejects(fetcher("https://example.com/jobs"));
    assert.equal(calls, 1);
  }
});

test("HTTP deadline includes stalled response body and bounds retry attempts", async () => {
  let calls = 0;
  let aborted = 0;
  const fetcher = createJsonFetcher({ timeoutMs: 15, retries: 1, sleep: async () => {}, fetchImpl: async (_url, options) => {
    calls++;
    options?.signal?.addEventListener("abort", () => { aborted++; });
    return new Response(new ReadableStream({ start() {} }));
  } });
  await assert.rejects(fetcher("https://example.com/jobs"), /timed out/i);
  assert.equal(calls, 2);
  assert.equal(aborted, 2);
});

test("HTTP deadline covers a stalled connection even with injected fetch", async () => {
  const fetcher = createJsonFetcher({ timeoutMs: 15, retries: 0, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(fetcher("https://example.com/jobs"), /timed out/i);
});
