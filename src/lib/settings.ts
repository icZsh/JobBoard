import { prisma } from "@/lib/prisma";

const DEFAULT_HIGH_FIT_THRESHOLD = 80;

export async function getHighFitThreshold() {
  const setting = await prisma.setting.findUnique({
    where: { key: "high_fit_threshold" },
  });
  const threshold = Number.parseInt(setting?.value ?? "", 10);

  if (!Number.isFinite(threshold) || threshold <= 0) {
    return DEFAULT_HIGH_FIT_THRESHOLD;
  }

  return threshold;
}
