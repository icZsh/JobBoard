import assert from "node:assert/strict";
import test from "node:test";
import { fetchSource, parsePostings, parseRegistry, sourceFromPostingUrl } from "../src/lib/discovery/ats";

const ashby = sourceFromPostingUrl("Acme", "https://jobs.ashbyhq.com/Acme/123e4567-e89b-12d3-a456-426614174000?utm_source=test")!;
const greenhouse = sourceFromPostingUrl("Acme", "https://job-boards.greenhouse.io/acme/jobs/127817")!;
const lever = sourceFromPostingUrl("Acme", "https://jobs.lever.co/acme/123e4567-e89b-12d3-a456-426614174000")!;
const postingId = "123e4567-e89b-12d3-a456-426614174000";
const ashbyJob = {
  title: "Data Engineer", location: "San Francisco", secondaryLocations: [{ location: "New York", address: { addressCountry: "USA" } }],
  isListed: true, isRemote: false, workplaceType: "Hybrid", descriptionHtml: "<p>Build pipelines.</p>", descriptionPlain: "Build pipelines.",
  publishedAt: "2026-10-12T16:21:55.393+00:00", employmentType: "FullTime",
  address: { postalAddress: { addressCountry: "USA", addressRegion: "California" } },
  jobUrl: `https://jobs.ashbyhq.com/Acme/${postingId}?utm_source=board`, applyUrl: `https://jobs.ashbyhq.com/Acme/${postingId}/application`,
};
const greenhouseJob = {
  id: 127817, internal_job_id: 144381, title: "Data Platform Engineer", updated_at: "2026-10-14T10:55:28-05:00",
  location: { name: "New York, NY" }, absolute_url: "https://careers.acme.example/job?gh_jid=127817",
  content: "&lt;p&gt;Build &amp;amp; maintain data.&lt;/p&gt;&lt;script&gt;bad()&lt;/script&gt;",
  departments: [{ id: 1, name: "Engineering" }], offices: [{ id: 2, location: "United States" }],
};
const leverJob = {
  id: postingId, text: "Analytics Engineer", categories: { location: "Remote", commitment: "Full-time", team: "Data", allLocations: ["Remote", "New York"] },
  country: "US", description: "<p>Build reliable analytics.</p>", descriptionPlain: "Build reliable analytics.",
  lists: [{ text: "Requirements", content: "<li>SQL</li><li>Python</li>" }], additional: "<p>Benefits included.</p>",
  workplaceType: "remote", hostedUrl: `https://jobs.lever.co/acme/${postingId}`, applyUrl: `https://jobs.lever.co/acme/${postingId}/apply`,
  createdAt: 1791822115393,
};
function jsonFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })) as typeof fetch;
}

test("source extraction accepts official posting variants and normalizes identity", () => {
  assert.equal(ashby.id, "ashby:acme");
  assert.equal(ashby.board, "Acme");
  assert.equal(sourceFromPostingUrl("Acme", "https://boards.greenhouse.io/acme/jobs/127817?gh_src=x")?.id, greenhouse.id);
  assert.equal(sourceFromPostingUrl("Acme", `https://jobs.lever.co/acme/${postingId}/apply`)?.id, lever.id);
  assert.equal(sourceFromPostingUrl("Acme", "https://jobs.ashbyhq.com/Acme")?.id, ashby.id);
  assert.equal(sourceFromPostingUrl("Acme", `https://jobs.eu.lever.co/acme/${postingId}`)?.provider, "lever");
  assert.equal(sourceFromPostingUrl("Flashpoint", "https://jobs.lever.co/flashpoint.io/123")?.board, "flashpoint.io");
  assert.equal(sourceFromPostingUrl("Superhuman", "https://jobs.ashbyhq.com/superhuman%20platform%20inc/123")?.board, "superhuman platform inc");
  assert.equal(sourceFromPostingUrl("Acme", "https://boards.greenhouse.io/embed/job_app?for=acme&token=127817")?.id, greenhouse.id);
  assert.equal(sourceFromPostingUrl("Acme", "https://boards.greenhouse.io/embed/job_app?token=127817"), null);
});

test("source extraction rejects unsafe and unsupported URLs", () => {
  for (const url of ["http://jobs.lever.co/acme", "https://jobs.lever.co.evil.test/acme", "https://u:p@jobs.lever.co/acme", "https://jobs.lever.co:123/acme", "https://jobs.lever.co/acme%2Fother", "https://localhost/acme", "https://jobs.lever.co/", "https://example.com/careers", "https://constructor/acme"])
    assert.equal(sourceFromPostingUrl("Acme", url), null, url);
});

test("registry requires evidence to match provider and board and rejects duplicate sources", () => {
  assert.deepEqual(parseRegistry({ schema_version: 1, sources: [ashby, greenhouse, lever] }).sources, [ashby, greenhouse, lever]);
  for (const bad of [
    { ...ashby, board: "../evil" }, { ...ashby, evidence_url: "https://jobs.ashbyhq.com/another" },
    { ...ashby, evidence_url: "https://jobs.lever.co/Acme" }, { ...ashby, enabled: "yes" },
    { ...ashby, id: "arbitrary" }, { ...ashby, company: "" },
  ]) assert.throws(() => parseRegistry({ schema_version: 1, sources: [bad] }));
  assert.throws(() => parseRegistry({ schema_version: 1, sources: [ashby, ashby] }));
  assert.throws(() => parseRegistry({ schema_version: 2, sources: [] }));
});

test("Ashby retains location countries, labels last publication and excludes unlisted postings", () => {
  const rows = parsePostings(ashby, { apiVersion: "1", jobs: [ashbyJob, { ...ashbyJob, isListed: false, jobUrl: "https://jobs.ashbyhq.com/Acme/hidden-id" }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, `ashby:${postingId}`);
  assert.equal(rows[0].source_url, `https://jobs.ashbyhq.com/Acme/${postingId}`);
  assert.equal(rows[0].published_at, "2026-10-12T16:21:55.393Z");
  assert.equal(rows[0].published_at_kind, "last_published");
  assert.match(rows[0].location, /New York/);
  assert.match(rows[0].location, /USA/);
});

test("Ashby posting URL must identify the expected board even if API supplies an id", () => {
  assert.throws(() => parsePostings(ashby, { apiVersion: "1", jobs: [{ ...ashbyJob, id: postingId, jobUrl: "https://evil.test/Acme/id" }] }));
  assert.throws(() => parsePostings(ashby, { apiVersion: "1", jobs: [{ ...ashbyJob, jobUrl: `https://jobs.ashbyhq.com/other/${postingId}` }] }));
});

test("Greenhouse keeps complete sanitized content and never treats updated_at as posting date", () => {
  const [row] = parsePostings(greenhouse, { jobs: [greenhouseJob], meta: { total: 1 } });
  assert.equal(row.key, "greenhouse:127817");
  assert.equal(row.source_url, "https://job-boards.greenhouse.io/acme/jobs/127817");
  assert.equal(row.published_at, null);
  assert.equal(row.published_at_kind, "unknown");
  assert.equal(row.description, "Build & maintain data.");
  assert.match(row.location, /United States/);
});

test("Greenhouse rejects missing content and mismatched total", () => {
  assert.throws(() => parsePostings(greenhouse, { jobs: [greenhouseJob], meta: { total: 2 } }));
  assert.throws(() => parsePostings(greenhouse, { jobs: [{ ...greenhouseJob, content: undefined }], meta: { total: 1 } }));
  assert.throws(() => parsePostings(greenhouse, { jobs: [], meta: { total: "0" } }));
});

test("Lever combines requirements, country and benefits and uses optional creation timestamp", () => {
  const [row] = parsePostings(lever, [leverJob]);
  assert.equal(row.key, `lever:${postingId}`);
  assert.match(row.location, /US/);
  assert.match(row.location, /New York/);
  assert.match(row.description, /SQL/);
  assert.match(row.description, /Python/);
  assert.match(row.description, /Benefits included/);
  assert.equal(row.published_at_kind, "created");
  assert.equal(parsePostings(lever, [{ ...leverJob, createdAt: undefined }])[0].published_at, null);
});

test("empty valid provider responses succeed but unexpected shapes and malformed rows fail", () => {
  for (const [source, raw] of [[ashby, { apiVersion: "1", jobs: [] }], [greenhouse, { jobs: [], meta: { total: 0 } }], [lever, []]] as const)
    assert.deepEqual(parsePostings(source, raw), []);
  for (const [source, raw] of [[ashby, {}], [ashby, { apiVersion: "2", jobs: [] }], [ashby, { apiVersion: "1", jobs: [ashbyJob, {}] }], [greenhouse, { jobs: [] }], [lever, { jobs: [] }], [lever, [leverJob, {}]]] as const)
    assert.throws(() => parsePostings(source, raw));
});

test("duplicate identities are malformed instead of silently removing missing jobs", () => {
  assert.throws(() => parsePostings(lever, [leverJob, leverJob]));
});

test("fetching uses fixed API endpoints, no credentials, and rejects redirects", async () => {
  let called = false;
  const result = await fetchSource(greenhouse, { fetcher: (async (url, init) => {
    called = true;
    assert.equal(String(url), "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return new Response(JSON.stringify({ jobs: [greenhouseJob], meta: { total: 1 } }));
  }) as typeof fetch });
  assert.equal(called, true);
  assert.equal(result.success, true);
  assert.equal(result.total_count, 1);
});

test("invalid source and disabled source never make network requests", async () => {
  for (const source of [{ ...ashby, board: "../../other" }, { ...ashby, enabled: false }]) {
    const result = await fetchSource(source, { fetcher: (() => { throw new Error("must not request"); }) as typeof fetch });
    assert.equal(result.success, false);
    assert.notEqual(result.error, "must not request");
  }
});

test("network, HTTP, JSON and schema failures return no partial postings", async () => {
  for (const fetcher of [
    (async () => { throw new Error("offline"); }) as typeof fetch,
    (async () => new Response("not found", { status: 404 })) as typeof fetch,
    (async () => new Response("{truncated")) as typeof fetch,
    jsonFetch({ apiVersion: "1", jobs: [ashbyJob, {}] }),
  ]) {
    const result = await fetchSource(ashby, { fetcher });
    assert.equal(result.success, false);
    assert.deepEqual(result.postings, []);
    assert.equal(result.total_count, 0);
    assert.ok(result.error);
  }
});

test("Lever fetches all pages and follows the official EU host from evidence", async () => {
  const source = sourceFromPostingUrl("Acme", "https://jobs.eu.lever.co/acme")!;
  const skips: number[] = [];
  const result = await fetchSource(source, { fetcher: (async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.eu.lever.co");
    const limit = Number(url.searchParams.get("limit"));
    const skip = Number(url.searchParams.get("skip"));
    assert.ok(limit > 0);
    skips.push(skip);
    const size = skip === 0 ? limit : 2;
    return new Response(JSON.stringify(Array.from({ length: size }, (_, i) => ({ ...leverJob, id: `job-${skip + i}` }))));
  }) as typeof fetch });
  assert.equal(result.success, true);
  assert.equal(skips.length, 2);
  assert.equal(result.postings.length, skips[1] + 2);
  assert.equal(result.postings[0].source_url, "https://jobs.eu.lever.co/acme/job-0");
});

test("Lever failure after a full first page discards partial results", async () => {
  let calls = 0;
  const result = await fetchSource(lever, { fetcher: (async (input) => {
    calls += 1;
    const url = new URL(String(input));
    const limit = Number(url.searchParams.get("limit"));
    return calls === 1 ? new Response(JSON.stringify(Array.from({ length: limit }, (_, i) => ({ ...leverJob, id: `job-${i}` })))) : new Response("[]", { status: 503 });
  }) as typeof fetch });
  assert.equal(calls, 2);
  assert.equal(result.success, false);
  assert.deepEqual(result.postings, []);
});

test("Lever repeated pages fail rather than claiming a complete scan", async () => {
  const result = await fetchSource(lever, { fetcher: (async (input) => {
    const limit = Number(new URL(String(input)).searchParams.get("limit"));
    return new Response(JSON.stringify(Array.from({ length: limit }, (_, i) => ({ ...leverJob, id: `job-${i}` }))));
  }) as typeof fetch });
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /duplicate/i);
});

test("response size and total source duration are bounded", async () => {
  const tooLarge = await fetchSource(ashby, { fetcher: (async () => new Response("{}", { headers: { "content-length": "999999999" } })) as typeof fetch });
  assert.equal(tooLarge.success, false);
  assert.match(tooLarge.error ?? "", /size/i);
  const timeout = await fetchSource(ashby, { timeoutMs: 10, fetcher: (() => new Promise(() => {})) as typeof fetch });
  assert.equal(timeout.success, false);
  assert.match(timeout.error ?? "", /timeout/i);
});

test("fetch empty success is distinguishable from failed scan", async () => {
  assert.deepEqual(await fetchSource(ashby, { fetcher: jsonFetch({ apiVersion: "1", jobs: [] }) }), { source_id: ashby.id, success: true, postings: [], total_count: 0 });
});

test("API board paths encode spaces and dots without letting evidence choose request URLs", async () => {
  const source = sourceFromPostingUrl("Superhuman", "https://jobs.ashbyhq.com/superhuman%20platform%20inc/123?redirect=https://evil.test")!;
  const result = await fetchSource(source, { fetcher: (async (input) => {
    assert.equal(String(input), "https://api.ashbyhq.com/posting-api/job-board/superhuman%20platform%20inc");
    return new Response(JSON.stringify({ apiVersion: "1", jobs: [] }));
  }) as typeof fetch });
  assert.equal(result.success, true);
});

test("response byte cap applies when content-length is omitted", async () => {
  const result = await fetchSource(ashby, { fetcher: (async () => new Response(new Uint8Array(24 * 1024 * 1024 + 1))) as typeof fetch });
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /size/i);
});

test("one source deadline covers every pagination request", async () => {
  const result = await fetchSource(lever, { timeoutMs: 15, fetcher: (async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const url = new URL(String(input));
    const limit = Number(url.searchParams.get("limit"));
    const skip = Number(url.searchParams.get("skip"));
    return new Response(JSON.stringify(Array.from({ length: limit }, (_, i) => ({ ...leverJob, id: `job-${skip + i}` }))));
  }) as typeof fetch });
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /timeout/i);
  assert.deepEqual(result.postings, []);
});
