"use server";
import { requireAdmin, assertServerActionOrigin } from "@/lib/auth/authorization";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseDateInput } from "@/lib/format";
import { parseJobStatus, updateJobTracking } from "@/lib/jobs/tracking";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function updateJobDetailTracking(formData: FormData) {
  await requireAdmin("/board");
  await assertServerActionOrigin();
  const jobId = getFormString(formData, "jobId");
  const status = parseJobStatus(getFormString(formData, "status"));

  if (!jobId || !status) {
    throw new Error("Invalid tracking update request.");
  }

  await updateJobTracking(jobId, {
    status,
    notes: getFormString(formData, "notes"),
    nextAction: getFormString(formData, "nextAction"),
    nextActionDate: parseDateInput(getFormString(formData, "nextActionDate")),
    appliedAt: parseDateInput(getFormString(formData, "appliedAt")),
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/today");
  revalidatePath("/board");
  redirect(`/jobs/${jobId}`);
}
