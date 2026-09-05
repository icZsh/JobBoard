import type { JsonFetcher } from "./types";

const MAX_RETRY_DELAY_MS = 5000;

class HttpReadError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly retryAfterMs?: number) {
    super(message);
  }
}

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const milliseconds = /^\d+(?:\.\d+)?$/.test(value.trim())
    ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.min(MAX_RETRY_DELAY_MS, Math.max(0, milliseconds)) : undefined;
}

/** A deadline covers each complete GET, including JSON body consumption. */
export function createJsonFetcher(options: {
  timeoutMs: number;
  retries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): JsonFetcher {
  const { timeoutMs, retries, fetchImpl = fetch, sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error("timeoutMs must be between 1 and 300000");
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) throw new Error("retries must be between 0 and 10");

  return async (url) => {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      let response: Response | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new HttpReadError(`GET timed out after ${timeoutMs} ms: ${url}`, true));
            controller.abort();
            // Also release an unlocked body when a custom transport ignores abort.
            void response?.body?.cancel().catch(() => {});
          }, timeoutMs);
        });
        const read = async () => {
          response = await fetchImpl(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
          if (!response.ok) {
            const failure = new HttpReadError(`GET returned HTTP ${response.status}: ${url}`, response.status === 429 || response.status >= 500, retryAfter(response.headers.get("Retry-After")));
            void response.body?.cancel().catch(() => {});
            throw failure;
          }
          return response.json() as Promise<unknown>;
        };
        return await Promise.race([read(), deadline]);
      } catch (error) {
        const retryable = error instanceof HttpReadError ? error.retryable : !(error instanceof SyntaxError);
        if (!retryable || attempt >= retries) throw error;
        // Clear the attempt deadline before waiting; retries get independent deadlines.
        clearTimeout(timer);
        await sleep(error instanceof HttpReadError && error.retryAfterMs !== undefined
          ? error.retryAfterMs
          : Math.min(MAX_RETRY_DELAY_MS, 250 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
