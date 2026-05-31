import { z } from "zod";
import { JobStatus } from "@/generated/prisma/client";
import { parseDateInput } from "@/lib/format";

const nullableString = z.string().nullable().optional();
const nullableDateInput = z
  .string()
  .nullable()
  .optional()
  .transform((value) =>
    value === undefined ? undefined : parseDateInput(value),
  );

export const trackingPatchSchema = z.object({
  status: z.enum(JobStatus).optional(),
  notes: nullableString,
  nextAction: nullableString,
  nextActionDate: nullableDateInput,
  appliedAt: nullableDateInput,
  resumePath: nullableString,
  resumeVersion: nullableString,
});

export type TrackingPatchInput = z.infer<typeof trackingPatchSchema>;
