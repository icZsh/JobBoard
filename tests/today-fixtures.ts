import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayClient, type TodayJobItem } from "../src/app/today/today-client";
import type { RecommendationCandidate } from "../src/lib/jobs/recommendation-eligibility";

export const runDate = new Date("2026-10-14T00:00:00.000Z");

export function candidate(
  jobId: string,
  fields: Partial<RecommendationCandidate> = {},
): RecommendationCandidate {
  return {
    jobId,
    status: "NEW",
    appliedAt: null,
    fitScore: 90,
    priority: "HIGH",
    previousRunDates: [],
    repeatReason: null,
    repeatEvidenceUrl: null,
    ...fields,
  };
}

export function repeated(jobId: string, fields: Partial<RecommendationCandidate> = {}) {
  return candidate(jobId, {
    fitScore: 92,
    previousRunDates: ["2026-10-07"],
    repeatReason: "The hiring manager confirmed this role now supports remote work.",
    repeatEvidenceUrl: "https://example.com/jobs/updated-role",
    ...fields,
  });
}

export function newJobs(count: number) {
  return Array.from({ length: count }, (_, index) => candidate(`new-${index}`));
}

export function todayItem(job: RecommendationCandidate): TodayJobItem {
  return {
    ...job,
    appliedAt: job.appliedAt ? new Date(job.appliedAt).toISOString() : null,
    previousRunDates: job.previousRunDates.map((date) => new Date(date).toISOString()),
    recommendationId: `recommendation-${job.jobId}`,
    title: `Role ${job.jobId}`,
    company: "Example",
    companyWebsiteUrl: null,
    location: "San Francisco",
    remoteType: null,
    salary: null,
    salarySort: 0,
    sourceUrl: "https://example.com/jobs/role",
    isRepeat: job.previousRunDates.length > 0,
    recommendationSuppressed: false,
    blockedByRelatedTracking: false,
    statusHue: "100",
    fitTier: "High fit",
    priorityClass: "badge-neutral",
    suggestedAction: "Apply today",
    datePosted: "Unknown",
    companyOverview: null,
    benefitsOverview: null,
    roleOverview: null,
    matchReason: null,
    concerns: null,
    matchedSkills: [],
    missingSkills: [],
    resumePath: "",
    resumeVersion: "",
  };
}

export function renderToday(jobs: TodayJobItem[], initialShowHidden = false, historicalReview = false) {
  return renderToStaticMarkup(createElement(TodayClient, {
    jobs,
    initialShowHidden,
    highFitThreshold: 80,
    runDate: runDate.toISOString(),
    historicalReview,
  }));
}
