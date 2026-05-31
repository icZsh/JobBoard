"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { JobStatus, type JobStatus as JobStatusValue } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const quickActionStatuses = new Set<string>([
  JobStatus.INTERESTED,
  JobStatus.APPLYING,
  JobStatus.APPLIED,
  JobStatus.PASSED,
  JobStatus.ARCHIVED,
]);

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getRedirectTarget(formData: FormData) {
  const redirectTo = getFormString(formData, "redirectTo");

  if (redirectTo.startsWith("/today")) {
    return redirectTo;
  }

  return "/today";
}

export async function updateTodayJobStatus(formData: FormData) {
  const jobId = getFormString(formData, "jobId");
  const status = getFormString(formData, "status") as JobStatusValue;

  if (!jobId || !quickActionStatuses.has(status)) {
    throw new Error("Invalid status update request.");
  }

  const existingTracking = await prisma.jobTracking.findUnique({
    where: { jobId },
  });

  if (!existingTracking) {
    throw new Error("Tracking row not found for job.");
  }

  const now = new Date();

  await prisma.jobTracking.update({
    where: { jobId },
    data: {
      status,
      statusChangedAt: now,
      appliedAt:
        status === JobStatus.APPLIED && !existingTracking.appliedAt
          ? now
          : undefined,
    },
  });

  revalidatePath("/today");
  redirect(getRedirectTarget(formData));
}
