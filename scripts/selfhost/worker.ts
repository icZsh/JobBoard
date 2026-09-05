import { runWorker } from "../../src/lib/selfhost/worker";

const shutdown = new AbortController();
process.once("SIGTERM", () => shutdown.abort());
process.once("SIGINT", () => shutdown.abort());

runWorker(shutdown.signal).catch((error: unknown) => {
  if (!shutdown.signal.aborted) {
    console.error(
      error instanceof Error ? error.message : "Collector worker failed",
    );
    process.exitCode = 1;
  }
});
