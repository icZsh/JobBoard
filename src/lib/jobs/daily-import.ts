import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { importPayloadSchema } from "../import/validation";
import { buildDedupeInfo, dedupeIncomingJobs } from "../import/dedupe";
import { filterRecommendationPayload, parseRecommendationHistory, sanitizeRecommendationHistory } from "./recommendation-history";

const sourceName = "daily_data_job_shortlist";
const apiOrigin = "http://127.0.0.1:3000";
const count = z.number().int().nonnegative();
const receiptSchema = z.object({
  ok: z.literal(true), status: z.literal("SUCCESS"), importRunId: z.string().min(1),
  receivedJobs: count, importedJobs: count, skippedDuplicateRows: count, recommendationsCreated: count,
  createdJobs: count.optional(), updatedJobs: count.optional(), recovered: z.boolean().optional(),
});
const attemptSchema = z.object({
  run_date: z.string(), source_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  payload_sha256: z.string().regex(/^[a-f0-9]{64}$/u), started_at: z.string().datetime(),
}).strict();
const runsSchema = z.object({
  import_runs: z.array(z.object({
    id: z.string().min(1), runDate: z.string(), status: z.enum(["PENDING", "SUCCESS", "FAILED"]), rawPayload: z.unknown(),
  })),
  job_recommendations: z.array(z.object({ jobId: z.string(), importRunId: z.string() })),
});
type Receipt = z.infer<typeof receiptSchema>;
type Attempt = z.infer<typeof attemptSchema>;
type Export = z.infer<typeof runsSchema>;
type Options = {
  inputPath: string; stateDir: string; runDate: string; dryRun?: boolean; markImported?: boolean;
  fetcher?: typeof fetch; now?: () => Date;
};
export type DailyImportResult = { kind: "imported" | "recovered" | "already-imported" | "dry-run"; receipt?: Receipt; selectedJobs: number };

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
// JSONB does not preserve object-key order. Array order is part of the submitted payload.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
async function optionalText(path: string) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function writeAtomically(path: string, text: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, text, { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
function importedCount(jobs: z.infer<typeof importPayloadSchema>["jobs"]) {
  return dedupeIncomingJobs(jobs.map((job) => ({ dedupe: buildDedupeInfo({
    company: job.company, title: job.title, location: job.location, sourceUrl: job.source_url,
  }) }))).length;
}
function validReceipt(raw: unknown, received: number, imported: number) {
  const parsed = receiptSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  if (value.receivedJobs !== received || value.importedJobs !== imported || value.importedJobs + value.skippedDuplicateRows !== received
    || value.recommendationsCreated !== value.importedJobs) return null;
  if (value.createdJobs !== undefined && value.updatedJobs !== undefined
    && value.createdJobs + value.updatedJobs !== value.importedJobs) return null;
  return value;
}

/** Called only AFTER discovery. One durable reservation permits at most one automatic POST per date. */
export async function publishDailyShortlist(options: Options): Promise<DailyImportResult> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const date = new Date(`${options.runDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(options.runDate) || !Number.isFinite(date.getTime())
    || date.toISOString().slice(0, 10) !== options.runDate) throw new Error("Invalid run date");
  const input = await readFile(options.inputPath, "utf8");
  const payload: unknown = JSON.parse(input);
  const parsed = importPayloadSchema.parse(payload);
  if (parsed.run_date !== options.runDate || parsed.source_name !== sourceName) throw new Error("Daily import date/source mismatch");
  const sourceHash = sha256(input);
  await mkdir(options.stateDir, { recursive: true });
  const path = (suffix: string) => join(options.stateDir, `${options.runDate}.${suffix}`);
  const [marker, rawReceipt, rawAttempt] = await Promise.all([
    optionalText(path("sha256")), optionalText(path("response.json")), optionalText(path("attempt.json")),
  ]);
  const attempt = rawAttempt === null ? null : attemptSchema.parse(JSON.parse(rawAttempt));
  if (attempt && attempt.run_date !== options.runDate) throw new Error("Unresolved attempt has a mismatched run date");

  async function readExport() {
    const response = await fetcher(`${apiOrigin}/api/export`, {
      headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Import verification export failed (HTTP ${response.status})`);
    const raw: unknown = await response.json();
    const history = parseRecommendationHistory(sanitizeRecommendationHistory(raw), now());
    return { history, exported: runsSchema.parse(raw) };
  }
  async function saveSuccess(receipt: Receipt, hash: string) {
    // Receipt first: a crash between these writes is recoverable from the server's successful run.
    await writeAtomically(path("response.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    await writeAtomically(path("sha256"), hash);
  }
  async function reconcile(exported: Export, reserved: Attempt | null): Promise<DailyImportResult | null> {
    const runs = exported.import_runs.filter((run) => run.runDate.slice(0, 10) === options.runDate);
    const successes = runs.filter((run) => run.status === "SUCCESS");
    if (successes.length > 1) throw new Error("Multiple successful imports already exist for this date; review required, no POST sent");
    if (successes.length === 1) {
      const run = successes[0];
      const raw = importPayloadSchema.parse(run.rawPayload);
      const expectedCount = importedCount(raw.jobs);
      let saved: Receipt | null = null;
      try { saved = rawReceipt === null ? null : validReceipt(JSON.parse(rawReceipt), raw.jobs.length, expectedCount); }
      catch { /* A torn legacy receipt is not evidence; the server payload must prove success below. */ }
      const verifiedReceipt = marker?.trim() === sourceHash && saved?.importRunId === run.id ? saved : null;
      const expectedHash = reserved?.payload_sha256 ?? sha256(canonical(payload));
      if (!verifiedReceipt && (sha256(canonical(run.rawPayload)) !== expectedHash
        || (reserved && reserved.source_sha256 !== sourceHash))) {
        throw new Error("A successful import already exists for this date with another payload; automatic reimport refused");
      }
      const imported = exported.job_recommendations.filter((item) => item.importRunId === run.id).length;
      if (imported !== expectedCount) throw new Error("Successful import has inconsistent recommendation counts; review required");
      const recovered: Receipt = verifiedReceipt ?? {
        ok: true, status: "SUCCESS", importRunId: run.id, receivedJobs: raw.jobs.length,
        importedJobs: imported, recommendationsCreated: imported, skippedDuplicateRows: raw.jobs.length - imported, recovered: true,
      };
      if (recovered.importedJobs !== imported) throw new Error("Local receipt disagrees with successful import; review required");
      if (!options.dryRun && !verifiedReceipt) await saveSuccess(recovered, sourceHash);
      return { kind: verifiedReceipt ? "already-imported" : "recovered", receipt: recovered, selectedJobs: imported };
    }
    if (runs.some((run) => run.status === "PENDING")) throw new Error("A pending import already exists for this date; outcome unresolved, no POST sent");
    return null;
  }

  // Fresh read after the scanner, separate from the snapshot paired with discovery outputs.
  const fresh = await readExport();
  const prior = await reconcile(fresh.exported, attempt);
  if (prior) return prior;
  if (attempt || marker !== null || rawReceipt !== null) {
    throw new Error("Prior import outcome is unresolved or unverified; no automatic retry, review server import history");
  }
  if (options.markImported) throw new Error("Cannot mark imported without a verified successful server import");
  const filtered = filterRecommendationPayload(payload, fresh.history, now());
  if (options.dryRun) return { kind: "dry-run", selectedJobs: filtered.eligibleCount };

  const reservation: Attempt = {
    run_date: options.runDate, source_sha256: sourceHash,
    payload_sha256: sha256(canonical(filtered.payload)), started_at: now().toISOString(),
  };
  // Exclusive creation is also the inter-process gate. A crash leaves a durable, unresolved attempt.
  try {
    const journal = await open(path("attempt.json"), "wx", 0o600);
    try { await journal.writeFile(`${JSON.stringify(reservation, null, 2)}\n`); await journal.sync(); }
    finally { await journal.close(); }
    const directory = await open(options.stateDir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Another import attempt is unresolved; no concurrent POST sent");
    throw error;
  }
  await writeAtomically(path("import-history.json"), `${JSON.stringify(fresh.history, null, 2)}\n`);
  await writeAtomically(path("filtered.json"), `${JSON.stringify(filtered.payload, null, 2)}\n`);
  try {
    const response = await fetcher(`${apiOrigin}/api/import-jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(filtered.payload),
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    const receipt = response.ok ? validReceipt(await response.json(), filtered.eligibleCount,
      importedCount(importPayloadSchema.parse(filtered.payload).jobs)) : null;
    if (receipt) {
      await saveSuccess(receipt, sourceHash);
      return { kind: "imported", receipt, selectedJobs: receipt.importedJobs };
    }
  } catch {
    // Timeout, lost response or local receipt-write failure may follow a successful commit.
    // Never POST again: verify the server's durable run below instead.
  }
  try {
    const recovered = await reconcile((await readExport()).exported, reservation);
    if (recovered) return recovered;
  } catch {
    // Keep the attempt journal for the next read-only reconciliation or operator investigation.
  }
  throw new Error("Import outcome is unverified; durable attempt retained and no automatic POST retry will occur");
}
