import { GoogleGenAI } from "@google/genai";
import { ResumeTailoringError } from "./errors";
import {
  parseGeminiResumeResponse,
  type TailoredResumeResponse,
} from "./schema";

const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown) {
  const value = String(
    error instanceof Error ? `${error.name} ${error.message}` : error,
  ).toLowerCase();

  return (
    value.includes("429") ||
    value.includes("rate limit") ||
    value.includes("quota") ||
    value.includes("resource_exhausted")
  );
}

function isAbortLikeError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new DOMException("Gemini request timed out.", "TimeoutError"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function toGeminiUnavailable(error: unknown) {
  return new ResumeTailoringError(
    "GEMINI_UNAVAILABLE",
    "Gemini could not generate a valid tailored resume. Try again or check logs.",
    error,
  );
}

export async function callGeminiResumeTailor(
  prompt: string,
  options: { timeoutMs?: number } = {},
): Promise<TailoredResumeResponse> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new ResumeTailoringError(
      "GEMINI_UNAVAILABLE",
      "Gemini is not configured. Add GEMINI_API_KEY to the JobBoard environment.",
    );
  }

  const client = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_RESUME_MODEL || DEFAULT_GEMINI_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await withTimeout(
        client.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        }),
        timeoutMs,
      );

      return parseGeminiResumeResponse(response.text ?? "");
    } catch (error) {
      if (error instanceof ResumeTailoringError) {
        lastError = error;

        if (error.code !== "GEMINI_INVALID_JSON" || attempt === MAX_ATTEMPTS) {
          throw error;
        }

        await sleep(750 * attempt);
        continue;
      }

      lastError = error;

      if (attempt === MAX_ATTEMPTS) {
        break;
      }

      if (isAbortLikeError(error)) {
        await sleep(1_000 * attempt);
      } else if (isRateLimitError(error)) {
        await sleep(4_000 * attempt);
      } else {
        await sleep(750 * attempt);
      }
    }
  }

  throw toGeminiUnavailable(lastError);
}
