import { z } from "zod";
import { Priority } from "@/generated/prisma/client";

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Expected YYYY-MM-DD date string")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: "Invalid date",
  });

const nullableTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

const optionalUrl = nullableTrimmedString.refine(
  (value) => {
    if (!value) {
      return true;
    }

    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Expected a valid URL" },
);

const prioritySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.enum(Priority))
  .nullable()
  .optional();

const optionalInt = z.number().int().nullable().optional();

export const minimumImportEnvelopeSchema = z.object({
  run_date: dateOnlySchema,
  jobs: z.array(z.unknown()),
});

export const importJobSchema = z.object({
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),
  location: nullableTrimmedString,
  remote_type: nullableTrimmedString,
  salary_min: optionalInt,
  salary_max: optionalInt,
  source_url: optionalUrl,
  date_posted: dateOnlySchema.nullable().optional(),
  description: nullableTrimmedString,
  fit_score: optionalInt,
  priority: prioritySchema,
  matched_skills: z.array(z.string().trim().min(1)).default([]),
  missing_skills: z.array(z.string().trim().min(1)).default([]),
  match_reason: nullableTrimmedString,
  concerns: nullableTrimmedString,
  suggested_action: nullableTrimmedString,
});

export const importPayloadSchema = z.object({
  run_date: dateOnlySchema,
  source_name: nullableTrimmedString,
  jobs: z.array(importJobSchema),
});

export type ParsedImportPayload = z.infer<typeof importPayloadSchema>;
export type ParsedImportJob = z.infer<typeof importJobSchema>;

export function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatZodError(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "payload";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
