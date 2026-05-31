import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed settings.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

function getHighFitThreshold() {
  const value = Number.parseInt(process.env.HIGH_FIT_THRESHOLD ?? "80", 10);
  return Number.isFinite(value) && value > 0 ? String(value) : "80";
}

async function createSettingIfMissing(key: string, value: string) {
  const existing = await prisma.setting.findUnique({ where: { key } });

  if (existing) {
    return;
  }

  await prisma.setting.create({
    data: { key, value },
  });
}

async function main() {
  await createSettingIfMissing(
    "resume_file_path",
    process.env.RESUME_FILE_PATH ?? "",
  );
  await createSettingIfMissing("high_fit_threshold", getHighFitThreshold());
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
