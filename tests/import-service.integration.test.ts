import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { JobStatus } from "../src/generated/prisma/client";
import { importJobsPayload } from "../src/lib/import/import-service";
import { prisma } from "../src/lib/prisma";
import { updateJobTracking } from "../src/lib/jobs/tracking";

const TEST_COMPANY = "Item8 Test Co";
const TEST_SOURCE_PREFIX = "item8_focused_test";

async function cleanupTestRows() {
  await prisma.$executeRaw`
    DELETE FROM jobs
    WHERE company = ${TEST_COMPANY}
  `;
  await prisma.$executeRaw`
    DELETE FROM import_runs
    WHERE source_name LIKE ${`${TEST_SOURCE_PREFIX}%`}
       OR raw_payload->>'source_name' LIKE ${`${TEST_SOURCE_PREFIX}%`}
  `;
}

function makePayload(sourceName: string) {
  return {
    run_date: "2026-05-30",
    source_name: sourceName,
    jobs: [
      {
        title: "Focused Backend Engineer",
        company: TEST_COMPANY,
        location: "Remote",
        remote_type: "remote",
        salary_min: 150000,
        salary_max: 190000,
        source_url: "https://example.com/item8/backend?utm_source=test",
        date_posted: "2026-05-29",
        description: "Build reliable services.",
        fit_score: 91,
        priority: "high",
        matched_skills: ["Postgres", "TypeScript"],
        missing_skills: ["Kubernetes"],
        match_reason: "Strong backend fit.",
        concerns: null,
        suggested_action: "Apply today.",
      },
    ],
  };
}

beforeEach(async () => {
  await cleanupTestRows();
});

after(async () => {
  await cleanupTestRows();
  await prisma.$disconnect();
});

test("duplicate imports add a recommendation without resetting tracking", async () => {
  const firstImport = await importJobsPayload(
    makePayload(`${TEST_SOURCE_PREFIX}_success_1`),
  );

  assert.equal(firstImport.ok, true);
  assert.equal(firstImport.createdJobs, 1);
  assert.equal(firstImport.updatedJobs, 0);
  assert.equal(firstImport.recommendationsCreated, 1);

  const job = await prisma.job.findFirstOrThrow({
    where: { company: TEST_COMPANY },
    include: { tracking: true },
  });

  assert.equal(job.tracking?.status, JobStatus.NEW);

  await updateJobTracking(job.id, {
    status: JobStatus.INTERESTED,
    notes: "Keep this note across imports.",
  });

  const secondImport = await importJobsPayload(
    makePayload(`${TEST_SOURCE_PREFIX}_success_2`),
  );

  assert.equal(secondImport.ok, true);
  assert.equal(secondImport.createdJobs, 0);
  assert.equal(secondImport.updatedJobs, 1);
  assert.equal(secondImport.recommendationsCreated, 1);

  const updatedJob = await prisma.job.findUniqueOrThrow({
    where: { id: job.id },
    include: {
      recommendations: true,
      tracking: true,
    },
  });

  assert.equal(updatedJob.tracking?.status, JobStatus.INTERESTED);
  assert.equal(updatedJob.tracking?.notes, "Keep this note across imports.");
  assert.equal(updatedJob.recommendations.length, 2);
});

test("invalid payloads with a minimum envelope preserve a failed raw payload", async () => {
  const result = await importJobsPayload({
    run_date: "2026-05-30",
    source_name: `${TEST_SOURCE_PREFIX}_invalid`,
    jobs: [
      {
        title: "",
        company: TEST_COMPANY,
      },
    ],
  });

  assert.equal(result.ok, false);

  if (result.ok) {
    throw new Error("Expected invalid import to fail.");
  }

  assert.equal(result.status, "FAILED");
  assert.equal(result.errorKind, "validation");
  assert.ok(result.importRunId);

  const failedRun = await prisma.importRun.findUniqueOrThrow({
    where: { id: result.importRunId },
  });

  assert.equal(failedRun.status, "FAILED");
  assert.equal(failedRun.errorMessage?.includes("title"), true);
  assert.equal(
    (failedRun.rawPayload as { source_name?: string }).source_name,
    `${TEST_SOURCE_PREFIX}_invalid`,
  );

  const jobCount = await prisma.job.count({
    where: { company: TEST_COMPANY },
  });

  assert.equal(jobCount, 0);
});

test("empty filtered shortlists succeed and preserve applied tracking", async () => {
  await importJobsPayload(makePayload(`${TEST_SOURCE_PREFIX}_empty_setup`));
  const job = await prisma.job.findFirstOrThrow({ where: { company: TEST_COMPANY } });
  await updateJobTracking(job.id, {
    status: JobStatus.APPLIED,
    notes: "Application remains tracked when there are no new recommendations.",
  });
  const before = await prisma.jobTracking.findUniqueOrThrow({ where: { jobId: job.id } });

  const result = await importJobsPayload({
    run_date: "2026-05-31",
    source_name: `${TEST_SOURCE_PREFIX}_empty`,
    jobs: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.importedJobs, 0);
  assert.equal(result.recommendationsCreated, 0);
  assert.deepEqual(
    await prisma.jobTracking.findUniqueOrThrow({ where: { jobId: job.id } }),
    before,
  );
});

test("repeat evidence survives import in raw recommendation context", async () => {
  const base = makePayload(`${TEST_SOURCE_PREFIX}_repeat_evidence`);
  const repeat = {
    ...base.jobs[0],
    repeat_reason: "Employer now confirms remote eligibility.",
    repeat_evidence_url: "https://example.com/item8/backend",
  };
  const result = await importJobsPayload({ ...base, jobs: [repeat] });
  assert.equal(result.ok, true);
  const recommendation = await prisma.jobRecommendation.findFirstOrThrow({
    where: { importRunId: result.importRunId },
  });
  const raw = recommendation.rawRecommendation as Record<string, unknown>;
  assert.equal(raw.repeat_reason, repeat.repeat_reason);
  assert.equal(raw.repeat_evidence_url, repeat.repeat_evidence_url);
});

test("distinct ATS requisitions do not inherit an older job's application", async () => {
  const base = makePayload(`${TEST_SOURCE_PREFIX}_identity_first`);
  base.jobs[0].source_url = "https://job-boards.greenhouse.io/item8-test/jobs/999999001";
  await importJobsPayload(base);
  const first = await prisma.job.findFirstOrThrow({ where: { company: TEST_COMPANY } });
  await updateJobTracking(first.id, { status: JobStatus.APPLIED });
  const before = await prisma.jobTracking.findUniqueOrThrow({ where: { jobId: first.id } });
  const second = await importJobsPayload({
    ...base,
    source_name: `${TEST_SOURCE_PREFIX}_identity_second`,
    jobs: [{ ...base.jobs[0], source_url: "https://job-boards.greenhouse.io/item8-test/jobs/999999002" }],
  });
  assert.equal(second.ok, true);
  assert.equal(second.createdJobs, 1);
  const jobs = await prisma.job.findMany({ where: { company: TEST_COMPANY }, include: { tracking: true } });
  assert.equal(jobs.length, 2);
  assert.equal(jobs.find((job) => job.id !== first.id)?.tracking?.status, JobStatus.NEW);
  assert.deepEqual(await prisma.jobTracking.findUniqueOrThrow({ where: { jobId: first.id } }), before);

  const alias = await importJobsPayload({
    ...base,
    source_name: `${TEST_SOURCE_PREFIX}_identity_alias`,
    jobs: [{ ...base.jobs[0], location: "Remote (US)", source_url: "https://careers.example.com/data-role?gh_jid=999999001" }],
  });
  assert.equal(alias.ok, true);
  assert.equal(alias.createdJobs, 0);
  assert.deepEqual(await prisma.jobTracking.findUniqueOrThrow({ where: { jobId: first.id } }), before);
});

test("explicit undo can restore a newly recorded application date", async () => {
  await importJobsPayload(makePayload(`${TEST_SOURCE_PREFIX}_undo`));
  const job = await prisma.job.findFirstOrThrow({ where: { company: TEST_COMPANY } });
  await updateJobTracking(job.id, { status: JobStatus.APPLIED });
  assert.ok((await prisma.jobTracking.findUniqueOrThrow({ where: { jobId: job.id } })).appliedAt);
  await updateJobTracking(job.id, { status: JobStatus.INTERESTED });
  assert.ok((await prisma.jobTracking.findUniqueOrThrow({ where: { jobId: job.id } })).appliedAt);
  await updateJobTracking(job.id, { status: JobStatus.NEW, appliedAt: null });
  assert.equal((await prisma.jobTracking.findUniqueOrThrow({ where: { jobId: job.id } })).appliedAt, null);
});
