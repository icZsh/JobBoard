import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRegistry, sourceFromPostingUrl } from "../src/lib/discovery/ats";
import { runDiscovery, seedDiscoveryRegistry, writeDiscoveryJson } from "../src/lib/discovery/runner";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const allowed: Record<string, string[]> = { seed: ["--history", "--registry"], scan: ["--history", "--registry", "--state-dir", "--date", "--force"], "add-source": ["--registry", "--company", "--url"] };
  if (!allowed[command]) throw new Error("Usage: discover-jobs.ts seed --history PATH --registry PATH | scan --history PATH --registry PATH --state-dir DIR --date YYYY-MM-DD [--force] | add-source --registry PATH --company NAME --url OFFICIAL_ATS_URL");
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed[command].includes(key) || options.has(key)) throw new Error("Unknown or duplicate option");
    if (key === "--force") { options.set(key, "true"); continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options.set(key, value);
  }
  for (const key of allowed[command].filter((key) => key !== "--force")) if (!options.has(key)) throw new Error(`Missing ${key}`);
  const registryPath = resolve(options.get("--registry")!);
  if (command === "add-source") {
    const registry = parseRegistry(JSON.parse(await readFile(registryPath, "utf8")));
    const source = sourceFromPostingUrl(options.get("--company")!, options.get("--url")!);
    if (!source) throw new Error("Expected a verified public Ashby, Greenhouse or Lever employer board URL");
    if (registry.sources.some((item) => item.id === source.id)) { console.log(`Already registered: ${source.id}`); return; }
    registry.sources.push(source);
    registry.sources.sort((a, b) => a.id.localeCompare(b.id));
    await writeDiscoveryJson(registryPath, parseRegistry(registry));
    console.log(`Registered ${source.id}; the next scan will verify API availability.`);
    return;
  }
  const historyPath = resolve(options.get("--history")!);
  if (registryPath === historyPath) throw new Error("Registry and history paths must differ");
  if (command === "seed") {
    const result = await seedDiscoveryRegistry(historyPath, registryPath);
    console.log(`Discovery registry: ${result.registry.sources.length} sources; ${result.added} added from historical official URLs.`);
    return;
  }
  const result = await runDiscovery({ registryPath, historyPath, stateDir: options.get("--state-dir")!, runDate: options.get("--date")!, force: options.has("--force") });
  console.log(`Discovery ${result.report.status}: ${result.report.sources_succeeded}/${result.report.sources_total} boards; ${result.queue.candidates.length} preliminary candidates; ${result.queue.review_holds.length} review holds; cached=${result.report.cached}.`);
  console.log(JSON.stringify(result.metrics));
  if (result.report.status === "failed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  // Never log provider response bodies or private input records.
  console.error(`Discovery: ${error instanceof SyntaxError ? "Invalid JSON file" : error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
