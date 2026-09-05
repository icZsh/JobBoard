import { z } from "zod";
import { ResumeTailoringError } from "./errors";

export const tailoredResumeResponseSchema = z.object({
  ok: z.literal(true),
  markdown: z.string().min(1),
  warnings: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  changes: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
});

export type TailoredResumeResponse = z.infer<
  typeof tailoredResumeResponseSchema
>;

function parseJsonObject(text: string) {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new ResumeTailoringError(
        "GEMINI_INVALID_JSON",
        "Gemini returned invalid resume JSON.",
      );
    }

    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
    } catch (error) {
      throw new ResumeTailoringError(
        "GEMINI_INVALID_JSON",
        "Gemini returned invalid resume JSON.",
        error,
      );
    }
  }
}

export function parseGeminiResumeResponse(text: string): TailoredResumeResponse {
  const parsedJson = parseJsonObject(text);
  const parsed = tailoredResumeResponseSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new ResumeTailoringError(
      "GEMINI_INVALID_JSON",
      "Gemini returned invalid resume JSON.",
      parsed.error,
    );
  }

  return parsed.data;
}
