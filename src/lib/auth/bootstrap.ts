import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "./password";
import { parseSelfHostInput } from "../selfhost/config";
export class SetupInputError extends Error {}

export async function bootstrapAdmin(value: unknown) {
  let input: { email: string; password: string; config?: unknown };
  let config: ReturnType<typeof parseSelfHostInput>;
  try {
    input = z
      .strictObject({
        email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
        password: z.string().min(12).max(256),
        config: z.unknown(),
      })
      .parse(value);
    config = parseSelfHostInput(input.config);
  } catch (error) {
    throw new SetupInputError(
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Check your setup fields.")
        : error instanceof Error
          ? error.message
          : "Check your setup fields.",
    );
  }
  const passwordHash = await hashPassword(input.password);
  // The singleton write serializes competing first-run requests. Any existing
  // user also closes setup; all three writes commit or roll back together.
  return prisma.$transaction(
    async (tx) => {
      await tx.bootstrap.create({ data: { id: "admin" } });
      if (await tx.user.count())
        throw new Error("Setup has already been completed.");
      const user = await tx.user.create({
        data: { email: input.email, passwordHash, role: "ADMIN" },
      });
      await tx.collectionConfig.create({
        data: {
          id: "default",
          value: config as unknown as Prisma.InputJsonValue,
        },
      });
      return { id: user.id };
    },
    { isolationLevel: "Serializable" },
  );
}
