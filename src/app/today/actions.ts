"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { JobStatus, type JobStatus as JobStatusValue } from "@/generated/prisma/client";
import { updateJobTracking } from "@/lib/jobs/tracking";

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

  await updateJobTracking(jobId, { status });

  revalidatePath("/today");
  redirect(getRedirectTarget(formData));
}
