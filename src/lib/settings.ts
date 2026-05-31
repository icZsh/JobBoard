import { prisma } from "@/lib/prisma";

const DEFAULT_HIGH_FIT_THRESHOLD = 80;
const RESUME_FILE_PATH_KEY = "resume_file_path";
const HIGH_FIT_THRESHOLD_KEY = "high_fit_threshold";

function parseHighFitThreshold(value: string | null | undefined) {
  const threshold = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(threshold) || threshold <= 0) {
    return DEFAULT_HIGH_FIT_THRESHOLD;
  }

  return threshold;
}

export async function getHighFitThreshold() {
  const setting = await prisma.setting.findUnique({
    where: { key: HIGH_FIT_THRESHOLD_KEY },
  });

  return parseHighFitThreshold(setting?.value);
}

export async function getSettingsValues() {
  const settings = await prisma.setting.findMany({
    where: {
      key: {
        in: [RESUME_FILE_PATH_KEY, HIGH_FIT_THRESHOLD_KEY],
      },
    },
  });
  const values = new Map(settings.map((setting) => [setting.key, setting.value]));

  return {
    resumeFilePath: values.get(RESUME_FILE_PATH_KEY) ?? "",
    highFitThreshold: parseHighFitThreshold(values.get(HIGH_FIT_THRESHOLD_KEY)),
  };
}

export async function updateSettingsValues(input: {
  resumeFilePath: string;
  highFitThreshold: number;
}) {
  await prisma.$transaction([
    prisma.setting.upsert({
      where: { key: RESUME_FILE_PATH_KEY },
      create: {
        key: RESUME_FILE_PATH_KEY,
        value: input.resumeFilePath.trim(),
      },
      update: {
        value: input.resumeFilePath.trim(),
      },
    }),
    prisma.setting.upsert({
      where: { key: HIGH_FIT_THRESHOLD_KEY },
      create: {
        key: HIGH_FIT_THRESHOLD_KEY,
        value: String(input.highFitThreshold),
      },
      update: {
        value: String(input.highFitThreshold),
      },
    }),
  ]);
}
