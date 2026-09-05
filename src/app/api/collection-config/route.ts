import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiAdmin } from "@/lib/auth/authorization";
import { readJsonBody } from "@/lib/auth/body";
import { getCollectionConfig, parseSelfHostInput } from "@/lib/selfhost/config";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = await requireApiAdmin(request);
  if (denied) return denied;
  return Response.json(
    { config: await getCollectionConfig() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function PUT(request: Request) {
  const denied = await requireApiAdmin(request);
  if (denied) return denied;
  try {
    const config = parseSelfHostInput(await readJsonBody(request));
    const value = config as unknown as Prisma.InputJsonValue;
    await prisma.collectionConfig.upsert({
      where: { id: "default" },
      create: { id: "default", value },
      update: { value },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        errorMessage:
          error instanceof Error && error.name === "ZodError"
            ? "Check your timezone, preferences, daily time, and company URLs."
            : error instanceof Error
              ? error.message
              : "Could not save settings.",
      },
      { status: 400 },
    );
  }
}
