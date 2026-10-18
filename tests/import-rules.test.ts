import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDedupeInfo,
  dedupeIncomingJobs,
  normalizeSourceUrl,
} from "../src/lib/import/dedupe";
import { previewImportPayload } from "../src/lib/import/import-service";
import { importPayloadSchema } from "../src/lib/import/validation";
import { filterRecommendationPayload } from "../src/lib/jobs/recommendation-history";

function makePreviewDb(existingJobIdsByDedupeKey = new Map<string, string>()) {
  return {
    $transaction: async <T>(
      callback: (tx: {
        job: {
          findUnique: (args: { where: { dedupeKey: string } }) => Promise<unknown>;
          findMany: (args: {
            where: { fallbackDedupeKey: string };
          }) => Promise<unknown[]>;
        };
      }) => Promise<T>,
    ) =>
      callback({
        job: {
          findUnique: async ({ where }) => {
            const id = existingJobIdsByDedupeKey.get(where.dedupeKey);
            return id ? { id } : null;
          },
          findMany: async ({ where }) => {
            const id = existingJobIdsByDedupeKey.get(
              where.fallbackDedupeKey,
            );
            return id ? [{ id }] : [];
          },
        },
      }),
  };
}

test("normalizes source URLs for primary deduplication", () => {
  assert.equal(
    normalizeSourceUrl(
      "HTTPS://Example.com:443/jobs/platform/?utm_source=list&b=2&a=1#details",
    ),
    "https://example.com/jobs/platform?a=1&b=2",
  );
});

test("dedupes incoming jobs by URL first and fallback only when needed", () => {
  const items = [
    {
      label: "url-a",
      dedupe: buildDedupeInfo({
        company: "ExampleCo",
        title: "Backend Engineer",
        location: "Remote",
        sourceUrl: "https://example.com/jobs/backend?utm_source=feed",
      }),
    },
    {
      label: "same-url",
      dedupe: buildDedupeInfo({
        company: "ExampleCo",
        title: "Backend Engineer",
        location: "Remote",
        sourceUrl: "https://example.com/jobs/backend",
      }),
    },
    {
      label: "different-url-same-fallback",
      dedupe: buildDedupeInfo({
        company: "ExampleCo",
        title: "Backend Engineer",
        location: "Remote",
        sourceUrl: "https://example.com/jobs/backend-2",
      }),
    },
    {
      label: "fallback-only",
      dedupe: buildDedupeInfo({
        company: "Acme",
        title: "Data Engineer",
        location: "Remote",
      }),
    },
    {
      label: "same-fallback-only",
      dedupe: buildDedupeInfo({
        company: " Acme ",
        title: "Data   Engineer",
        location: "Remote",
      }),
    },
  ];

  assert.deepEqual(
    dedupeIncomingJobs(items).map((item) => item.label),
    ["url-a", "different-url-same-fallback", "fallback-only"],
  );
});

test("dedupes ATS aliases while preserving different requisitions", () => {
  const jobs = [
    "https://job-boards.greenhouse.io/acme/jobs/12345",
    "https://careers.example.com/job?gh_jid=12345",
    "https://job-boards.greenhouse.io/acme/jobs/12346",
  ].map((sourceUrl) => ({
    sourceUrl,
    dedupe: buildDedupeInfo({ company: "Acme", title: "Engineer", location: "Remote", sourceUrl }),
  }));
  assert.deepEqual(dedupeIncomingJobs(jobs).map((job) => job.sourceUrl), [jobs[0].sourceUrl, jobs[2].sourceUrl]);
});

test("validates and normalizes import payload fields", () => {
  const parsed = importPayloadSchema.parse({
    run_date: "2026-05-30",
    source_name: " daily_job_automation ",
    jobs: [
      {
        title: " Backend Engineer ",
        company: " ExampleCo ",
        source_url: "",
        priority: "high",
      },
    ],
  });

  assert.equal(parsed.source_name, "daily_job_automation");
  assert.equal(parsed.jobs[0].title, "Backend Engineer");
  assert.equal(parsed.jobs[0].company, "ExampleCo");
  assert.equal(parsed.jobs[0].source_url, null);
  assert.equal(parsed.jobs[0].priority, "HIGH");
  assert.deepEqual(parsed.jobs[0].matched_skills, []);
  assert.deepEqual(parsed.jobs[0].missing_skills, []);
});

test("preserves optional repeat evidence and rejects unsafe evidence links", () => {
  const job = {
    title: "Data Engineer",
    company: "ExampleCo",
    repeat_reason: "Employer now confirms US remote eligibility.",
    repeat_evidence_url: "https://example.com/careers/data-engineer",
  };
  const payload = { run_date: "2026-10-14", jobs: [job] };
  const parsed = importPayloadSchema.parse(payload);
  assert.equal(parsed.jobs[0].repeat_reason, job.repeat_reason);
  assert.equal(parsed.jobs[0].repeat_evidence_url, job.repeat_evidence_url);
  for (const url of ["javascript:alert(1)", "http://example.com/job", "not a URL"]) {
    assert.equal(importPayloadSchema.safeParse({
      ...payload,
      jobs: [{ ...job, repeat_evidence_url: url }],
    }).success, false);
  }
  assert.deepEqual(importPayloadSchema.parse({ ...payload, jobs: [] }).jobs, []);
});

test("previews invalid rows, payload duplicates, and existing matches", async () => {
  const existingKey = buildDedupeInfo({
    company: "ExistingCo",
    title: "Backend Engineer",
    location: "Remote",
    sourceUrl: "https://existing.example/jobs/backend",
  }).urlKey;
  const existingMap = new Map<string, string>();

  if (existingKey) {
    existingMap.set(existingKey, "existing-job-id");
  }

  const preview = await previewImportPayload(
    {
      run_date: "2026-05-30",
      source_name: "preview_test",
      jobs: [
        {
          title: "Platform Engineer",
          company: "NewCo",
          location: "Remote",
          source_url: "https://new.example/jobs/platform?utm_campaign=x",
        },
        {
          title: "Platform Engineer",
          company: "NewCo",
          location: "Remote",
          source_url: "https://new.example/jobs/platform",
        },
        {
          title: "Backend Engineer",
          company: "ExistingCo",
          location: "Remote",
          source_url: "https://existing.example/jobs/backend",
        },
        {
          title: "",
          company: "BrokenCo",
        },
      ],
    },
    makePreviewDb(existingMap) as never,
  );

  assert.equal(preview.canImport, false);
  assert.equal(preview.totalJobs, 4);
  assert.equal(preview.validJobs, 3);
  assert.equal(preview.invalidJobs, 1);
  assert.equal(preview.inPayloadDuplicates, 1);
  assert.equal(preview.wouldImportJobs, 2);
  assert.equal(preview.newJobs, 1);
  assert.equal(preview.duplicateJobs, 1);
  assert.equal(preview.rows[1].duplicateInPayload, true);
  assert.equal(preview.rows[2].existingJobId, "existing-job-id");
  assert.equal(preview.rows[3].errors.length > 0, true);
});

test("history filter suppresses the applied empty-location row that importer preview would reuse", async () => {
  const now = new Date("2026-10-15T01:00:00.000Z");
  for (const location of [null, "", " \t "]) {
    const historicalJob = {
      job_id: "applied-without-location", company: "Example", title: "Data Engineer",
      location, source_url: null, status: "APPLIED", applied_at: null, recommended_run_dates: [],
    };
    const dedupe = buildDedupeInfo(historicalJob);
    const existing = {
      id: historicalJob.job_id, sourceUrl: null,
      dedupeKey: dedupe.fallbackKey, fallbackDedupeKey: dedupe.fallbackKey,
    };
    const payload = {
      run_date: "2026-10-15", jobs: [{
        company: historicalJob.company, title: historicalJob.title, location: null,
        source_url: "https://job-boards.greenhouse.io/example/jobs/123", fit_score: 96, priority: "high",
      }],
    };
    const db = {
      $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback({
        job: {
          findUnique: async ({ where }: { where: { dedupeKey: string } }) =>
            where.dedupeKey === existing.dedupeKey ? existing : null,
          findMany: async ({ where }: { where: { fallbackDedupeKey?: string; sourceUrl?: { contains: string } } }) => {
            if (where.sourceUrl) return [];
            return where.fallbackDedupeKey === existing.fallbackDedupeKey ? [existing] : [];
          },
        },
      }),
    };
    const preview = await previewImportPayload(payload, db as never);
    assert.equal(preview.rows[0].existingJobId, historicalJob.job_id);
    assert.equal(preview.newJobs, 0);
    const filtered = filterRecommendationPayload(payload, {
      schema_version: 1, generated_at: now.toISOString(), jobs: [historicalJob],
    }, now);
    assert.equal(filtered.eligibleCount, 0);
    assert.equal(filtered.suppressions[0].reason, "already_applied_or_in_pipeline");
  }
});
