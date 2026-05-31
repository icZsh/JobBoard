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
