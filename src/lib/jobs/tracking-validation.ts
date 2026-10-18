import { z } from "zod";
import { JobStatus } from "@/generated/prisma/client";
import { parseDateInput } from "@/lib/format";

const nullableString = z.string().nullable().optional();
const nullableDateInput = z
  .union([z.iso.date(), z.iso.datetime({ offset: true }), z.literal("")], {
    error: "Use a YYYY-MM-DD date or an ISO timestamp.",
  })
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }

    // Timestamps keep their exact instant, e.g. when Today's Undo restores
    // the original application time.
    return value?.includes("T") ? new Date(value) : parseDateInput(value);
  });

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
