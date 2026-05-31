import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getExportFileName(date: Date) {
  return `job-board-export-${date.toISOString().slice(0, 10)}.json`;
}

export async function GET() {
  const exportedAt = new Date();
  const [jobs, jobTracking, jobRecommendations, importRuns, settings] =
    await prisma.$transaction([
      prisma.job.findMany({
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      }),
      prisma.jobTracking.findMany({
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      }),
      prisma.jobRecommendation.findMany({
        orderBy: [{ createdAt: "desc" }],
      }),
      prisma.importRun.findMany({
        orderBy: [{ runDate: "desc" }, { createdAt: "desc" }],
      }),
      prisma.setting.findMany({
        orderBy: [{ key: "asc" }],
      }),
    ]);

  return Response.json(
    {
      exported_at: exportedAt.toISOString(),
      jobs,
      job_tracking: jobTracking,
      job_recommendations: jobRecommendations,
      import_runs: importRuns,
      settings,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${getExportFileName(
          exportedAt,
        )}"`,
      },
    },
  );
}
