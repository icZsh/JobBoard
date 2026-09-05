export type ResumeTailoringErrorCode =
  | "JOB_NOT_FOUND"
  | "RESUME_NOT_CONFIGURED"
  | "RESUME_NOT_TEXT"
  | "RESUME_UNREADABLE"
  | "NO_JOB_CONTEXT"
  | "GEMINI_UNAVAILABLE"
  | "GEMINI_INVALID_JSON"
  | "OUTPUT_WRITE_FAILED"
  | "TRACKING_UPDATE_FAILED";

export class ResumeTailoringError extends Error {
  constructor(
    public readonly code: ResumeTailoringErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ResumeTailoringError";
  }
}

export function isResumeTailoringError(
  error: unknown,
): error is ResumeTailoringError {
  return error instanceof ResumeTailoringError;
}
