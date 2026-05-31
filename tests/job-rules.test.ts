import assert from "node:assert/strict";
import test from "node:test";
import { JobStatus } from "../src/generated/prisma/client";
import { formatDateInput, formatSalary, formatStatusLabel } from "../src/lib/format";
import { sanitizeJobDescription } from "../src/lib/jobs/description";
import { isApplyTodayJob, isHighFit } from "../src/lib/jobs/prioritization";
import {
  getLatestRecommendation,
  sortRecommendationsByLatest,
} from "../src/lib/jobs/recommendations";
import { parseJobStatus } from "../src/lib/jobs/tracking";

test("formats status, salaries, and date inputs for UI controls", () => {
  assert.equal(formatStatusLabel("APPLYING"), "Applying");
  assert.equal(formatStatusLabel("APPLY_TODAY"), "Apply Today");
  assert.equal(formatSalary(150000, 190000), "$150,000 - $190,000");
  assert.equal(formatSalary(150000, null), "$150,000+");
  assert.equal(formatSalary(null, 190000), "Up to $190,000");
  assert.equal(
    formatDateInput(new Date("2026-05-30T20:15:00.000Z")),
    "2026-05-30",
  );
});

test("identifies high-fit and apply-today jobs from recommendation context", () => {
  assert.equal(isHighFit(80, 80), true);
  assert.equal(isHighFit(79, 80), false);
  assert.equal(
    isApplyTodayJob({
      fitScore: 70,
      concerns: "Needs Kubernetes",
      status: JobStatus.PASSED,
      suggestedAction: "Apply today.",
      highFitThreshold: 80,
    }),
    true,
  );
  assert.equal(
    isApplyTodayJob({
      fitScore: 70,
      concerns: null,
      status: JobStatus.APPLIED,
      suggestedAction: "Apply this week.",
      highFitThreshold: 80,
    }),
    false,
  );
  assert.equal(
    isApplyTodayJob({
      fitScore: 85,
      concerns: "",
      status: JobStatus.NEW,
      suggestedAction: null,
      highFitThreshold: 80,
    }),
    true,
  );
});

test("sorts recommendations by newest run date and import creation time", () => {
  const recommendations = [
    {
      id: "older-created",
      importRun: {
        runDate: new Date("2026-05-30T00:00:00.000Z"),
        createdAt: new Date("2026-05-30T09:00:00.000Z"),
      },
    },
    {
      id: "newest-run-date",
      importRun: {
        runDate: new Date("2026-05-31T00:00:00.000Z"),
        createdAt: new Date("2026-05-31T08:00:00.000Z"),
      },
    },
    {
      id: "newer-created",
      importRun: {
        runDate: new Date("2026-05-30T00:00:00.000Z"),
        createdAt: new Date("2026-05-30T10:00:00.000Z"),
      },
    },
  ];

  assert.deepEqual(
    sortRecommendationsByLatest(recommendations).map(
      (recommendation) => recommendation.id,
    ),
    ["newest-run-date", "newer-created", "older-created"],
  );
  assert.equal(getLatestRecommendation(recommendations)?.id, "newest-run-date");
});

test("sanitizes imported HTML descriptions before rendering", () => {
  const sanitized = sanitizeJobDescription(
    '<p onclick="alert(1)">Safe</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://example.com/jobs">good</a>',
  );

  assert.equal(sanitized.includes("<script"), false);
  assert.equal(sanitized.includes("onclick"), false);
  assert.equal(sanitized.includes("javascript:"), false);
  assert.equal(sanitized.includes('href="https://example.com/jobs"'), true);
  assert.equal(sanitized.includes('target="_blank"'), true);
  assert.equal(sanitized.includes('rel="noreferrer"'), true);
});

test("parses known tracking statuses and rejects unknown values", () => {
  assert.equal(parseJobStatus("APPLYING"), JobStatus.APPLYING);
  assert.equal(parseJobStatus("not-a-status"), null);
  assert.equal(parseJobStatus(null), null);
});
