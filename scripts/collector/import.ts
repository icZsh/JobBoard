import { parseArgs } from "node:util";
import { submitRun } from "../../src/lib/collector/submit";

async function main() {
  const { values } = parseArgs({
    options: {
      "run-dir": { type: "string" },
      url: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log("Usage: npm run collector:import -- --run-dir <directory> --url http://127.0.0.1:3001/api/import-jobs");
    return;
  }
  if (!values["run-dir"] || !values.url) throw new Error("Both --run-dir and --url are required; there is no default import destination.");
  const result = await submitRun({ runDir: values["run-dir"], targetUrl: values.url });
  console.log(result.status === "imported" ? "Import confirmed SUCCESS; response saved in the run's import-state directory." : "Already imported to this endpoint; saved SUCCESS response verified. No request sent.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Import failed.");
  process.exitCode = 1;
});
