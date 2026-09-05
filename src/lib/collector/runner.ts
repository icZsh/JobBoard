import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { importPayloadSchema } from "../import/validation";
import { createJsonFetcher } from "./http";
import { fetchSource as fetchProviderSource } from "./providers";
import { evaluatePosting, toImportJob } from "./rules";
import { postingKey, sourceKey, type CollectorConfig, type CollectorPayload, type CollectorPosting, type CollectorSource, type RuleDecision } from "./types";

const observationSchema = z.object({
  source: z.string().min(1), externalId: z.string().min(1), title: z.string(), company: z.string(), sourceUrl: z.string(),
  firstSeenAt: z.iso.datetime(), lastSeenAt: z.iso.datetime(), lastCheckedAt: z.iso.datetime(),
  presence: z.enum(["present", "missing"]), missingSince: z.iso.datetime().nullable(),
}).strict();
const stateSchema = z.object({ version: z.literal(1), postings: z.record(z.string(), observationSchema) }).strict();
export type CollectorState = z.infer<typeof stateSchema>;
export const emptyState = (): CollectorState => ({ version: 1, postings: {} });
export const parseState = (value: unknown): CollectorState => stateSchema.parse(value);

interface SourceReport {
  key: string;
  company: string;
  status: "success" | "failed";
  postings: number;
  error: string | null;
}

export interface CollectionReport {
  version: 1;
  runDate: string;
  fetchedAt: string;
  complete: boolean;
  sources: SourceReport[];
  observedCount: number;
  eligibleCount: number;
  selectedCount: number;
  duplicateRows: number;
  missingFromFeed: string[];
  excluded: { key: string; company: string; title: string; reasons: string[] }[];
  scoring: "rules-v1";
}

interface CollectionOptions {
  config: CollectorConfig;
  now?: Date;
  runDate?: string;
  previousState?: CollectorState;
  fetchSource?: (source: CollectorSource) => Promise<CollectorPosting[]>;
}

export function localRunDate(now: Date, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validateDate(value: string) {
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error("Run date must be a real calendar date in YYYY-MM-DD format.");
  }
}

async function mapBounded<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

export async function collect(options: CollectionOptions) {
  const { config } = options;
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const runDate = options.runDate ?? localRunDate(now);
  validateDate(runDate);
  const enabled = config.sources.filter((s) => s.enabled);
  if (!enabled.length) throw new Error("At least one source must be enabled.");
  const state = parseState(options.previousState ?? emptyState());
  const jsonFetcher = createJsonFetcher(config.request);
  const getSource = options.fetchSource ?? ((source: CollectorSource) => fetchProviderSource(source, jsonFetcher));
  const collected = await mapBounded(enabled, config.request.concurrency, async (source) => {
    try {
      const postings = await getSource(source);
      if (postings.some((p) => sourceKey(p) !== sourceKey(source))) throw new Error("Provider returned postings for a different source.");
      return { source, postings, error: null };
    } catch (error) {
      return { source, postings: [] as CollectorPosting[], error: error instanceof Error ? error.message : "Unknown source failure" };
    }
  });

  const unique = new Map<string, CollectorPosting>();
  const successfulSources = new Set<string>();
  let duplicateRows = 0;
  for (const result of collected) {
    if (result.error !== null) continue;
    successfulSources.add(sourceKey(result.source));
    for (const posting of result.postings) {
      const key = postingKey(posting);
      if (unique.has(key)) { duplicateRows++; continue; }
      unique.set(key, posting);
      const old = state.postings[key];
      state.postings[key] = {
        source: sourceKey(posting), externalId: posting.externalId, title: posting.title,
        company: posting.company, sourceUrl: posting.sourceUrl,
        firstSeenAt: old?.firstSeenAt ?? fetchedAt, lastSeenAt: fetchedAt, lastCheckedAt: fetchedAt,
        presence: "present", missingSince: null,
      };
    }
  }
  const missingFromFeed: string[] = [];
  for (const [key, observation] of Object.entries(state.postings)) {
    if (successfulSources.has(observation.source) && !unique.has(key)) {
      state.postings[key] = { ...observation, presence: "missing", missingSince: observation.missingSince ?? fetchedAt, lastCheckedAt: fetchedAt };
      missingFromFeed.push(key);
    }
  }

  const snapshot = [...unique.values()].map((posting) => ({ posting, decision: evaluatePosting(posting, config.rules, runDate) }));
  const eligible = snapshot.filter(({ decision }) => decision.included).sort((a, b) =>
    b.decision.score - a.decision.score || (b.posting.datePosted ?? "").localeCompare(a.posting.datePosted ?? "") || postingKey(a.posting).localeCompare(postingKey(b.posting)));
  const payload: CollectorPayload = {
    run_date: runDate, source_name: "ats_collector_rules_v1",
    jobs: eligible.slice(0, config.rules.maxResults).map(({ posting, decision }) => toImportJob(posting, decision, fetchedAt)),
  };
  importPayloadSchema.parse(payload);
  const report: CollectionReport = {
    version: 1, runDate, fetchedAt, complete: collected.every((r) => r.error === null),
    sources: collected.map((r) => ({ key: sourceKey(r.source), company: r.source.company, status: r.error === null ? "success" : "failed", postings: r.postings.length, error: r.error })),
    observedCount: unique.size, eligibleCount: eligible.length, selectedCount: payload.jobs.length, duplicateRows, missingFromFeed,
    excluded: snapshot.filter(({ decision }) => !decision.included).map(({ posting, decision }) => ({ key: postingKey(posting), company: posting.company, title: posting.title, reasons: decision.reasons })),
    scoring: "rules-v1",
  };
  return { payload, report, state, snapshot };
}

function cell(value: unknown) {
  return String(value ?? "Unknown").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
}

function reviewMarkdown(payload: CollectorPayload, report: CollectionReport, snapshot: { posting: CollectorPosting; decision: RuleDecision }[]) {
  const lines = [
    `# ATS collection · ${payload.run_date}`, "",
    `Status: **${report.complete ? "complete" : "partial — source failures; not eligible for import"}**. ${report.observedCount} unique postings observed; ${report.eligibleCount} pass screening; ${report.selectedCount} shortlisted.`, "",
    "Scores use configurable rules (rules-v1), not AI or a fresh resume evaluation. Missing feed membership is an observation, not confirmed closure. Collection does not import to JobBoard.", "",
    "## Shortlist", "", "| Company | Role | Location | Score | Posted / evidence |", "|---|---|---|---:|---|",
    ...payload.jobs.map((job) => `| ${cell(job.company)} | ${cell(job.title)} | ${cell(job.location)} | ${job.fit_score} | ${cell(job.date_posted)} / ${job.collector.date_evidence} |`),
    "", "## Review details", "",
    ...payload.jobs.flatMap((job) => [`### ${cell(job.company)} — ${cell(job.title)}`, "", `Apply: <${job.source_url}>`, "", cell(job.match_reason), "", `Concerns: ${cell(job.concerns)}`, ""]),
    "## Sources", "", "| Source | Company | Result | Postings | Error |", "|---|---|---|---:|---|",
    ...report.sources.map((source) => `| ${source.key} | ${cell(source.company)} | ${source.status} | ${source.postings} | ${cell(source.error ?? "")} |`),
    "", "## Screening diagnostics", "", "See snapshot.json for every normalized posting, rule decision and concern; report.json records all exclusions and source failures.", "",
    `${snapshot.filter((s) => !s.decision.included).length} postings excluded by rules. ${report.missingFromFeed.length} previously observed postings missing from successfully fetched feeds.`, "",
  ];
  return lines.join("\n");
}

async function atomicWrite(file: string, content: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

async function readState(outputDir: string) {
  try { return parseState(JSON.parse(await readFile(path.join(outputDir, "state.json"), "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw new Error("Collector state.json is unreadable or invalid; refusing to overwrite observation history.", { cause: error });
  }
}

export async function collectToDirectory(options: Omit<CollectionOptions, "previousState"> & { outputDir: string }) {
  const outputDir = path.resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const lock = path.join(outputDir, ".collection.lock");
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Collector output is locked by another run. If no collector is running, remove the stale .collection.lock directory.");
    throw error;
  }
  try {
    const previousState = await readState(outputDir);
    const result = await collect({ ...options, previousState });
    const runName = `${result.report.fetchedAt.replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
    const runDir = path.join(outputDir, "runs", runName);
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    const payloadText = serialize(result.payload);
    const report = { ...result.report, payloadSha256: createHash("sha256").update(payloadText).digest("hex") };
    await atomicWrite(path.join(runDir, "payload.json"), payloadText);
    await atomicWrite(path.join(runDir, "snapshot.json"), serialize(result.snapshot));
    await atomicWrite(path.join(runDir, "config.json"), serialize(options.config));
    await atomicWrite(path.join(runDir, "review.md"), reviewMarkdown(result.payload, report, result.snapshot));
    await atomicWrite(path.join(runDir, "report.json"), serialize(report));
    await atomicWrite(path.join(outputDir, "state.json"), serialize(result.state));
    return { ...result, report, runDir };
  } finally { await rm(lock, { recursive: true, force: true }); }
}
