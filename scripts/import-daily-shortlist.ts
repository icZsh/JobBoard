import { publishDailyShortlist } from "../src/lib/jobs/daily-import";

async function main() {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (["--dry-run", "--mark-imported"].includes(key)) { flags.add(key); continue; }
    const value = args[++index];
    if (!["--input", "--state-dir", "--date"].includes(key) || !value || value.startsWith("--") || values.has(key)) {
      throw new Error("Usage: import-daily-shortlist.ts --input PATH --state-dir PATH --date YYYY-MM-DD [--dry-run | --mark-imported]");
    }
    values.set(key, value);
  }
  if (values.size !== 3 || flags.size > 1) throw new Error("Provide input, state-dir and date, with at most one mode flag");
  const result = await publishDailyShortlist({
    inputPath: values.get("--input")!, stateDir: values.get("--state-dir")!, runDate: values.get("--date")!,
    dryRun: flags.has("--dry-run"), markImported: flags.has("--mark-imported"),
  });
  console.log(`Daily import: ${result.kind}; ${result.selectedJobs} jobs${result.receipt ? `; run ${result.receipt.importRunId}` : ""}.`);
}

main().catch((error: unknown) => {
  console.error(`Daily import: ${error instanceof Error ? error.message : "Unknown failure"}`);
  process.exitCode = 1;
});
