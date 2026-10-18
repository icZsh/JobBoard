import { getStablePostingId } from "@/lib/import/posting-identity";
export { getStablePostingId } from "@/lib/import/posting-identity";
import { z } from "zod";
import { normalizeSourceUrl, normalizeTextForDedupe } from "@/lib/import/dedupe";
import { importPayloadSchema, parseDateOnly } from "@/lib/import/validation";
import { selectRecommendations, type RecommendationCandidate } from "@/lib/jobs/recommendation-eligibility";

const dayMs = 24 * 60 * 60 * 1000;
const statusSchema = z.enum(["NEW", "INTERESTED", "APPLYING", "APPLIED", "INTERVIEWING", "OFFER", "REJECTED", "PASSED", "ARCHIVED"]);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const timestampSchema = z.string().datetime();
const runDateSchema = z.union([dateOnlySchema, timestampSchema]);

const historyJobSchema = z.object({
  job_id: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().nullable(),
  source_url: z.string().nullable(),
  status: statusSchema,
  applied_at: timestampSchema.nullable(),
  recommended_run_dates: z.array(dateOnlySchema),
}).strict();

const historySchema = z.object({
  schema_version: z.literal(1),
  generated_at: timestampSchema,
  jobs: z.array(historyJobSchema),
}).strict();

const exportSchema = z.object({
  exported_at: timestampSchema,
  jobs: z.array(z.object({
    id: z.string().min(1), title: z.string().min(1), company: z.string().min(1),
    location: z.string().nullable(), sourceUrl: z.string().nullable(),
  })),
  job_tracking: z.array(z.object({
    jobId: z.string().min(1), status: statusSchema, appliedAt: timestampSchema.nullable(),
  })),
  import_runs: z.array(z.object({
    id: z.string().min(1), status: z.enum(["PENDING", "SUCCESS", "FAILED"]), runDate: runDateSchema,
  })),
  job_recommendations: z.array(z.object({ jobId: z.string().min(1), importRunId: z.string().min(1) })),
});

export type RecommendationHistoryJob = z.infer<typeof historyJobSchema>;
export type RecommendationHistory = z.infer<typeof historySchema>;

/** Whitelists fields before anything is written to the agent-readable context file. */
export function sanitizeRecommendationHistory(rawExport: unknown): RecommendationHistory {
  const data = exportSchema.parse(rawExport);
  const jobs = new Map(data.jobs.map((job) => [job.id, job]));
  const runs = new Map(data.import_runs.map((run) => [run.id, run]));
  const tracking = new Map(data.job_tracking.map((item) => [item.jobId, item]));
  if (jobs.size !== data.jobs.length || runs.size !== data.import_runs.length || tracking.size !== data.job_tracking.length) {
    throw new Error("Export contains duplicate record IDs");
  }
  for (const jobId of tracking.keys()) {
    if (!jobs.has(jobId)) throw new Error("Export tracking references a missing job");
  }
  const dates = new Map<string, Set<string>>();
  for (const recommendation of data.job_recommendations) {
    const run = runs.get(recommendation.importRunId);
    if (!jobs.has(recommendation.jobId) || !run) {
      throw new Error("Export recommendation references missing history");
    }
    if (run.status !== "SUCCESS") continue;
    const jobDates = dates.get(recommendation.jobId) ?? new Set<string>();
    jobDates.add(run.runDate.slice(0, 10));
    dates.set(recommendation.jobId, jobDates);
  }
  return {
    schema_version: 1,
    generated_at: data.exported_at,
    jobs: data.jobs.map((job) => ({
      job_id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      source_url: job.sourceUrl,
      status: tracking.get(job.id)?.status ?? "NEW",
      applied_at: tracking.get(job.id)?.appliedAt ?? null,
      recommended_run_dates: Array.from(dates.get(job.id) ?? []).sort(),
    })).sort((left, right) => left.job_id.localeCompare(right.job_id)),
  };
}

export function parseRecommendationHistory(rawHistory: unknown, now = new Date()): RecommendationHistory {
  const history = historySchema.parse(rawHistory);
  const age = now.getTime() - Date.parse(history.generated_at);
  if (!Number.isFinite(age)) throw new Error("Invalid current time");
  if (age < 0) throw new Error("History snapshot is from the future; refresh it before filtering");
  if (age > dayMs) throw new Error("History snapshot is stale (older than 24 hours); refresh it before filtering");
  if (new Set(history.jobs.map((job) => job.job_id)).size !== history.jobs.length) {
    throw new Error("History snapshot contains duplicate job IDs");
  }
  return history;
}


type ListingIdentity = {
  company: string;
  title: string;
  location?: string | null;
  source_url?: string | null;
};

function identityOf(listing: ListingIdentity) {
  const stableId = getStablePostingId(listing.source_url);
  let url = normalizeSourceUrl(listing.source_url);
  if (url && !/^https?:\/\//u.test(url)) url = null;
  const location = normalizeTextForDedupe(listing.location);
  const fallback = location ? JSON.stringify([
    normalizeTextForDedupe(listing.company), normalizeTextForDedupe(listing.title), location,
  ]) : null;
  return { stableId, url, key: stableId ?? url, fallback };
}

/** Fallback never joins two known identities or bridges an ambiguous title/location. */
export function findMatchingHistory<T extends ListingIdentity>(listing: ListingIdentity, history: T[]) {
  const identity = identityOf(listing);
  const indexed = history.map((job) => ({ job, identity: identityOf(job) }));
  const direct = indexed.filter((entry) => {
    if (identity.stableId && entry.identity.stableId) return identity.stableId === entry.identity.stableId;
    return identity.url !== null && identity.url === entry.identity.url;
  });
  const fallback = identity.fallback ? indexed.filter((entry) => entry.identity.fallback === identity.fallback) : [];
  const fallbackKeys = new Set(fallback.map((entry) => entry.identity.key).filter((key) => key !== null));
  if (identity.key) fallbackKeys.add(identity.key);
  const ambiguous = !identity.key && fallbackKeys.size > 1;
  const fallbackMatches = fallbackKeys.size <= 1 ? fallback.filter((entry) => !identity.key || !entry.identity.key) : [];
  const matched = new Set([...direct, ...fallbackMatches].map((entry) => entry.job));
  return { matches: history.filter((job) => matched.has(job)), ambiguous };
}

type FilterCandidate = RecommendationCandidate & { index: number; original: unknown };
export type RecommendationSuppression = { index: number; company: string; title: string; reason: string };

function repeatSuppressionReason(candidate: FilterCandidate, runDate: Date) {
  if (candidate.appliedAt || ["APPLYING", "APPLIED", "INTERVIEWING", "OFFER"].includes(candidate.status ?? "")) return "already_applied_or_in_pipeline";
  if (!["NEW", "INTERESTED"].includes(candidate.status ?? "NEW")) return "closed_or_dismissed";
  const priorDates = candidate.previousRunDates.map((date) => new Date(date).getTime()).filter((date) => date < runDate.getTime());
  if (priorDates.length) {
    if ((candidate.fitScore ?? 0) < 90 || candidate.priority !== "HIGH") return "repeat_not_exceptional_fit";
    if (!candidate.repeatReason?.trim() || !candidate.repeatEvidenceUrl?.startsWith("https://")) return "repeat_missing_evidence";
  }
  return "shortlist_limit";
}

export function filterRecommendationPayload(rawPayload: unknown, rawHistory: unknown, now = new Date()) {
  const history = parseRecommendationHistory(rawHistory, now);
  const parsed = importPayloadSchema.parse(rawPayload);
  // The existing importer permits date rollover; the selection boundary must not.
  dateOnlySchema.parse(parsed.run_date);
  const originalPayload = rawPayload as Record<string, unknown> & { jobs: unknown[] };
  const runDate = parseDateOnly(parsed.run_date);
  const candidates: FilterCandidate[] = [];
  const seenListings: ListingIdentity[] = [];
  const suppressions: RecommendationSuppression[] = [];
  parsed.jobs.forEach((job, index) => {
    const suppress = (reason: string) => suppressions.push({ index, company: job.company, title: job.title, reason });
    const previousInPayload = findMatchingHistory(job, seenListings);
    if (previousInPayload.matches.length) { suppress("duplicate_in_payload"); return; }
    if (previousInPayload.ambiguous) { suppress("ambiguous_listing_identity"); return; }
    seenListings.push(job);
    const match = findMatchingHistory(job, history.jobs);
    if (match.ambiguous) { suppress("ambiguous_history_identity"); return; }
    const blockedTracking = match.matches.find((item) => !["NEW", "INTERESTED"].includes(item.status));
    const appliedAt = match.matches.find((item) => item.applied_at)?.applied_at ?? null;
    const original = originalPayload.jobs[index] as Record<string, unknown>;
    candidates.push({
      jobId: `incoming:${index}`,
      index,
      original,
      status: blockedTracking?.status ?? match.matches[0]?.status ?? "NEW",
      appliedAt,
      fitScore: job.fit_score ?? null,
      priority: job.priority ?? null,
      previousRunDates: Array.from(new Set(match.matches.flatMap((item) => item.recommended_run_dates))),
      repeatReason: typeof original.repeat_reason === "string" ? original.repeat_reason : null,
      repeatEvidenceUrl: typeof original.repeat_evidence_url === "string" ? original.repeat_evidence_url : null,
    });
  });
  const selected = selectRecommendations(candidates, runDate);
  for (const candidate of selected.suppressed) {
    const job = parsed.jobs[candidate.index];
    suppressions.push({ index: candidate.index, company: job.company, title: job.title, reason: repeatSuppressionReason(candidate, runDate) });
  }
  suppressions.sort((left, right) => left.index - right.index);
  return {
    payload: { ...originalPayload, jobs: selected.eligible.map((candidate) => candidate.original) },
    inputCount: parsed.jobs.length,
    eligibleCount: selected.eligible.length,
    suppressions,
  };
}
