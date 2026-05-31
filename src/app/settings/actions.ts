"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateSettingsValues } from "@/lib/settings";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function saveSettings(formData: FormData) {
  const resumeFilePath = getFormString(formData, "resumeFilePath");
  const thresholdValue = Number.parseInt(
    getFormString(formData, "highFitThreshold"),
    10,
  );

  if (
    !Number.isFinite(thresholdValue) ||
    thresholdValue < 1 ||
    thresholdValue > 100
  ) {
    redirect("/settings?error=high-fit-threshold");
  }

  await updateSettingsValues({
    resumeFilePath,
    highFitThreshold: thresholdValue,
  });

  revalidatePath("/settings");
  revalidatePath("/today");
  redirect("/settings?saved=1");
}
