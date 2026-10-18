import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { filterRecommendationPayload, parseRecommendationHistory, sanitizeRecommendationHistory } from "../src/lib/jobs/recommendation-history";

async function writeJsonAtomically(path: string, value: unknown) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function parseArguments() {
  const [command, ...args] = process.argv.slice(2);
  const allowed = command === "snapshot" ? ["--output"] : command === "filter" ? ["--history", "--input", "--output"] : [];
  if (!allowed.length) throw new Error("Usage: recommendation-history.ts snapshot --output PATH | filter --history PATH --input PATH --output PATH");
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.includes(key) || !value || value.startsWith("--") || options.has(key)) throw new Error("Invalid or duplicate command option");
    options.set(key, value);
  }
  if (allowed.some((key) => !options.has(key))) throw new Error(`Required options: ${allowed.join(", ")}`);
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments();
  const output = options.get("--output")!;
  if (command === "snapshot") {
    const response = await fetch("http://127.0.0.1:3000/api/export", {
      headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Local history export failed (HTTP ${response.status})`);
    const history = parseRecommendationHistory(sanitizeRecommendationHistory(await response.json()));
    await writeJsonAtomically(output, history);
    console.log(`Recommendation history: ${history.jobs.length} jobs; generated ${history.generated_at}.`);
    return;
  }
  const historyPath = resolve(options.get("--history")!);
  const inputPath = resolve(options.get("--input")!);
  if (resolve(output) === historyPath || resolve(output) === inputPath) throw new Error("Filter output must differ from its history and input files");
  const [history, payload] = await Promise.all([readFile(historyPath, "utf8"), readFile(inputPath, "utf8")]);
  const result = filterRecommendationPayload(JSON.parse(payload), JSON.parse(history));
  await writeJsonAtomically(output, result.payload);
  const reasons = new Map<string, number>();
  for (const item of result.suppressions) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  console.log(`Recommendation filter: ${result.inputCount} candidates, ${result.eligibleCount} eligible, ${result.suppressions.length} suppressed.`);
  if (reasons.size) console.log(`Suppressed: ${Array.from(reasons, ([reason, count]) => `${reason}=${count}`).join(", ")}.`);
}

main().catch((error: unknown) => {
  // Validation messages contain paths, not the raw export, notes or resume content.
  const message = error instanceof z.ZodError
    ? error.issues.map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`).join("; ")
    : error instanceof SyntaxError ? "Invalid JSON input or export response"
    : error instanceof Error ? error.message : "Unknown failure";
  console.error(`Recommendation history: ${message}`);
  process.exitCode = 1;
});
