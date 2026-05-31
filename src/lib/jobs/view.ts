import { JobStatus, type JobStatus as JobStatusValue, type Priority } from "@/generated/prisma/client";

export const hiddenJobStatuses = [JobStatus.PASSED, JobStatus.ARCHIVED];

export const statusHueByStatus: Record<JobStatusValue, string> = {
  NEW: "var(--st-new)",
  INTERESTED: "var(--st-interested)",
  APPLYING: "var(--st-applying)",
  APPLIED: "var(--st-applied)",
  INTERVIEWING: "var(--st-interviewing)",
  OFFER: "var(--st-offer)",
  REJECTED: "var(--st-rejected)",
  PASSED: "var(--st-passed)",
  ARCHIVED: "var(--st-archived)",
};

export function getFitTier(fitScore: number | null | undefined) {
  if (typeof fitScore !== "number") {
    return "Not scored";
  }

  if (fitScore >= 90) {
    return "Exceptional";
  }

  if (fitScore >= 80) {
    return "Strong";
  }

  if (fitScore >= 70) {
    return "Worth a look";
  }

  return "Stretch";
}

export function formatCompactSalary(min: number | null, max: number | null) {
  const compact = (value: number) => `$${Math.round(value / 1000)}k`;

  if (min && max) {
    return `${compact(min)}-${compact(max)}`;
  }

  if (min) {
    return `${compact(min)}+`;
  }

  if (max) {
    return `Up to ${compact(max)}`;
  }

  return null;
}

export function getSalarySortValue(min: number | null, max: number | null) {
  return max ?? min ?? 0;
}

export function priorityBadgeClass(priority: Priority | null | undefined) {
  if (priority === "HIGH" || priority === "URGENT") {
    return "badge-high";
  }

  if (priority === "MEDIUM") {
    return "badge-fit";
  }

  return "badge-neutral";
}
