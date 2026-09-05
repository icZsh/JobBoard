"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, assertServerActionOrigin } from "@/lib/auth/authorization";
import { prisma } from "@/lib/prisma";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function saveSettings(formData: FormData) {
  await requireAdmin("/settings");
  await assertServerActionOrigin();
  const thresholdValue = Number(getFormString(formData, "highFitThreshold"));

  if (
    !Number.isInteger(thresholdValue) ||
    thresholdValue < 1 ||
    thresholdValue > 100
  ) {
    redirect("/settings?error=high-fit-threshold");
  }

  await prisma.setting.upsert({
    where: { key: "high_fit_threshold" },
    create: { key: "high_fit_threshold", value: String(thresholdValue) },
    update: { value: String(thresholdValue) },
  });

  revalidatePath("/settings");
  revalidatePath("/today");
  redirect("/settings?saved=1");
}
