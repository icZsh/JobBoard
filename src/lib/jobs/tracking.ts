import { JobStatus, type JobStatus as JobStatusValue } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const jobStatusOptions = [
  JobStatus.NEW,
  JobStatus.INTERESTED,
  JobStatus.APPLYING,
  JobStatus.APPLIED,
  JobStatus.INTERVIEWING,
  JobStatus.OFFER,
  JobStatus.REJECTED,
  JobStatus.PASSED,
  JobStatus.ARCHIVED,
] as const;

const jobStatusSet = new Set<string>(jobStatusOptions);

export type TrackingUpdateInput = {
  status?: JobStatusValue;
  notes?: string | null;
  nextAction?: string | null;
  nextActionDate?: Date | null;
  appliedAt?: Date | null;
  resumePath?: string | null;
  resumeVersion?: string | null;
};

export function parseJobStatus(value: unknown) {
  return typeof value === "string" && jobStatusSet.has(value)
    ? (value as JobStatusValue)
    : null;
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function updateJobTracking(
  jobId: string,
  input: TrackingUpdateInput,
) {
  const existingTracking = await prisma.jobTracking.findUnique({
    where: { jobId },
  });

  if (!existingTracking) {
    throw new Error("Tracking row not found for job.");
  }

  const now = new Date();
  const statusChanged =
    Boolean(input.status) && input.status !== existingTracking.status;
  const shouldSetDefaultAppliedAt =
    input.status === JobStatus.APPLIED &&
    !existingTracking.appliedAt &&
    input.appliedAt == null;
  const appliedAt = shouldSetDefaultAppliedAt ? now : input.appliedAt;

  return prisma.jobTracking.update({
    where: { jobId },
    data: {
      status: input.status,
      statusChangedAt: statusChanged ? now : undefined,
      notes: normalizeOptionalText(input.notes),
      nextAction: normalizeOptionalText(input.nextAction),
      nextActionDate: input.nextActionDate,
      appliedAt,
      resumePath: normalizeOptionalText(input.resumePath),
      resumeVersion: normalizeOptionalText(input.resumeVersion),
    },
  });
}
