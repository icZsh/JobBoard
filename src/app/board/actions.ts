"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseJobStatus, updateJobTracking } from "@/lib/jobs/tracking";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function updateBoardJobStatus(formData: FormData) {
  const jobId = getFormString(formData, "jobId");
  const status = parseJobStatus(getFormString(formData, "status"));

  if (!jobId || !status) {
    throw new Error("Invalid status update request.");
  }

  await updateJobTracking(jobId, { status });
  revalidatePath("/board");
  redirect("/board");
}
