import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseConfig } from "../../src/lib/collector/config";
import { collectToDirectory } from "../../src/lib/collector/runner";

async function main() {
  const { values } = parseArgs({ options: {
    "config-dir": { type: "string", default: "config/collector" },
    output: { type: "string", default: ".collector-output" },
    date: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log("Usage: npm run collector:collect -- [--config-dir config/collector] [--output .collector-output] [--date YYYY-MM-DD]\nReads public ATS feeds and writes local review artifacts only. Does not import or install a schedule.");
    return;
  }
  const configDir = path.resolve(values["config-dir"]!);
  const [sources, rules, request] = await Promise.all(["sources.json", "rules.json", "request.json"].map(async (name) => JSON.parse(await readFile(path.join(configDir, name), "utf8"))));
  const config = parseConfig({ version: 1, sources, rules, request });
  console.log(`Collecting ${config.sources.filter((s) => s.enabled).length} sources; output: ${path.resolve(values.output!)}`);
  const result = await collectToDirectory({ config, outputDir: values.output!, runDate: values.date });
  for (const source of result.report.sources) console.log(`${source.key}: ${source.status} (${source.postings} postings)${source.error ? ` — ${source.error}` : ""}`);
  console.log(`${result.report.observedCount} observed; ${result.report.eligibleCount} eligible; ${result.report.selectedCount} shortlisted.\nReview: ${path.join(result.runDir, "review.md")}\nPayload: ${path.join(result.runDir, "payload.json")}\nNo jobs imported.`);
  if (!result.report.complete) process.exitCode = 2;
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Collection failed"); process.exitCode = 1; });
