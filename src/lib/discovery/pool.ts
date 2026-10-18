import { z } from "zod";
import { findMatchingHistory, parseRecommendationHistory, type RecommendationHistory } from "../jobs/recommendation-history";
import type { DiscoveryPosting, SourceScanResult } from "./types";

const dayMs = 24 * 60 * 60 * 1000;
const timestamp = z.string().datetime();
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "Expected HTTPS source URL");
const postingSchema = z.object({
  key: z.string().min(1), source_id: z.string().min(1), provider: z.enum(["ashby", "greenhouse", "lever"]),
  external_id: z.string().min(1), company: z.string().min(1), title: z.string().min(1), location: z.string(),
  source_url: httpsUrl, description: z.string(), employment_type: z.string().nullable(), workplace_type: z.string().nullable(),
  published_at: timestamp.nullable(), published_at_kind: z.enum(["last_published", "created", "unknown"]),
}).strict();
const pooledPostingSchema = postingSchema.extend({
  first_seen_at: timestamp, last_seen_at: timestamp, last_checked_at: timestamp,
  availability: z.enum(["active", "missing", "unverified"]),
}).strict();
const sourceSchema = z.object({
  source_id: z.string().min(1), last_checked_at: timestamp, last_successful_scan_at: timestamp.nullable(), success: z.boolean(),
}).strict();
const poolSchema = z.object({
  schema_version: z.literal(1), updated_at: timestamp, sources: z.array(sourceSchema), postings: z.array(pooledPostingSchema),
}).strict();

export type DiscoveryPool = z.infer<typeof poolSchema>;
export type PoolPosting = z.infer<typeof pooledPostingSchema>;
export type ScreeningEvidence = { field: string; value: string; reason: string };
export type PreliminaryScreening = {
  status: "candidate" | "hold" | "excluded";
  reasons: string[];
  evidence: ScreeningEvidence[];
};
export type DiscoveryQueueEntry = PoolPosting & {
  previously_recommended: boolean;
  recommended_run_dates: string[];
  screening: PreliminaryScreening;
};
export type DiscoveryQueue = {
  schema_version: 1;
  generated_at: string;
  history_generated_at: string;
  candidates: DiscoveryQueueEntry[];
  review_holds: DiscoveryQueueEntry[];
};
export type DiscoveryMetrics = {
  scanned_boards: number;
  successful_boards: number;
  failed_boards: number;
  raw_retrieved: number;
  relevant_retrieved: number;
  first_discovered: number;
  active: number;
  new_recommendation_candidates: number;
  repeat_candidates: number;
  held: number;
  excluded: number;
  exclusion_reasons: Record<string, number>;
  hold_reasons: Record<string, number>;
};

export function parsePool(raw: unknown): DiscoveryPool {
  const pool = poolSchema.parse(raw);
  if (new Set(pool.sources.map((source) => source.source_id)).size !== pool.sources.length) throw new Error("Duplicate pool source identity");
  if (new Set(pool.postings.map((posting) => posting.key)).size !== pool.postings.length) throw new Error("Duplicate pool posting identity");
  const sources = new Map(pool.sources.map((source) => [source.source_id, source]));
  for (const posting of pool.postings) {
    if (!sources.has(posting.source_id)) throw new Error("Pool posting references missing source");
    if (posting.first_seen_at > posting.last_seen_at || posting.last_seen_at > posting.last_checked_at) throw new Error("Pool posting timestamps are out of order");
  }
  return pool;
}

function isRelevant(posting: DiscoveryPosting) {
  // Keep broad engineering aliases for review, without treating them as a fit.
  return /\b(engineer(?:ing)?|developer|architect)\b/iu.test(posting.title)
    && !/\b(sales|solutions?|support|customer|civil|mechanical|electrical|hardware|manufacturing|quality assurance|qa)\b/iu.test(posting.title);
}

function canonicalHistoryUrl(sourceUrl: string | null) {
  if (!sourceUrl) return sourceUrl;
  try {
    const url = new URL(sourceUrl);
    if (["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname)) {
      const id = url.pathname.match(/^\/[^/]+\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:\/|$)/iu)?.[1];
      if (id) return `https://jobs.lever.co/posting/${id.toLowerCase()}`;
    }
  } catch { /* The existing matcher handles malformed/missing identities safely. */ }
  return sourceUrl;
}

function screen(posting: PoolPosting, source: DiscoveryPool["sources"][number] | undefined, history: RecommendationHistory, now: Date): DiscoveryQueueEntry {
  const exclude: string[] = [];
  const hold: string[] = [];
  const evidence: ScreeningEvidence[] = [];
  const add = (kind: "exclude" | "hold", reason: string, field: string, value: string) => {
    (kind === "exclude" ? exclude : hold).push(reason);
    evidence.push({ field, value, reason });
  };
  const title = posting.title;
  if (!isRelevant(posting)) add("exclude", "unrelated_role", "title", title);
  const match = findMatchingHistory({ ...posting, source_url: canonicalHistoryUrl(posting.source_url) }, history.jobs);
  const dates = [...new Set(match.matches.flatMap((job) => job.recommended_run_dates))].sort();
  if (match.ambiguous) add("hold", "ambiguous_history_identity", "source_url", posting.source_url);
  if (match.matches.some((job) => job.applied_at || ["APPLYING", "APPLIED", "INTERVIEWING", "OFFER"].includes(job.status))) {
    add("exclude", "already_applied_or_in_pipeline", "history", "Matching posting is applied or in pipeline");
  } else if (match.matches.some((job) => !["NEW", "INTERESTED"].includes(job.status))) {
    add("exclude", "closed_or_dismissed", "history", "Matching posting is closed or dismissed");
  }
  if (posting.availability === "missing") add("exclude", "source_missing", "availability", posting.availability);
  else if (posting.availability === "unverified" || !source?.success) add("hold", "source_unverified", "availability", posting.availability);
  else if (!source.last_successful_scan_at || now.getTime() - Date.parse(source.last_successful_scan_at) > dayMs) {
    add("hold", "source_stale", "last_seen_at", posting.last_seen_at);
  }
  if (/\b(senior|sr\.?|staff|principal|lead|manager|director|head|vp|vice president)\b/iu.test(title)) add("exclude", "unsupported_seniority", "title", title);
  if (/\b(intern(?:ship)?|new[ -]?grad(?:uate)?|university grad(?:uate)?|early career graduate)\b/iu.test(title)) add("exclude", "intern_or_new_grad", "title", title);
  if (/\b(contract(?:or)?|temporary|freelance|part[ -]?time)\b/iu.test(`${title} ${posting.employment_type ?? ""}`)) add("exclude", "unsupported_employment", "employment_type", `${title}; ${posting.employment_type ?? "unknown"}`);
  if (!/\b(data|analytics?|streaming|machine learning|ml|business intelligence|bi)\b/iu.test(title)) {
    add("hold", "role_specialism_unclear", "title", title);
  }

  const location = posting.location;
  const remote = /\bremote\b/iu.test(`${location} ${posting.workplace_type ?? ""}`);
  const us = /\b(united states(?: of america)?|usa|u\.s\.?a?\.?|us)\b/iu.test(location);
  const targetCity = /\b(san francisco|bay area|san mateo|redwood city|palo alto|menlo park|mountain view|sunnyvale|santa clara|san jose|oakland|berkeley|new york|nyc|manhattan|brooklyn)\b/iu.test(location);
  const foreign = /\b(india|bengaluru|bangalore|hyderabad|mumbai|pune|canada|toronto|vancouver|london|united kingdom|uk|europe|emea|apac|australia|sydney|singapore|germany|berlin|france|paris|china|japan|brazil|mexico|ireland|dublin|israel|tel aviv|poland|warsaw|netherlands|amsterdam)\b/iu.test(location);
  const otherUsCity = /\b(austin|seattle|boston|chicago|los angeles|denver|atlanta|dallas|miami|washington|portland|phoenix|san diego|raleigh|philadelphia|pittsburgh)\b/iu.test(location);
  if (foreign && !us && !targetCity) add("exclude", "unsupported_location", "location", location);
  else if (foreign || (!targetCity && !(us && remote) && !otherUsCity)) add("hold", "location_unclear", "location", location || "Not specified");
  else if (!targetCity && !(us && remote)) add("exclude", "unsupported_location", "location", location);
  else evidence.push({ field: "location", value: location, reason: "target_geography_signal" });

  // Never infer level from a company age or a collaborator's senior title. Optional
  // qualifications do not create a mandatory experience floor.
  const text = posting.description.replace(/<[^>]*>/gu, " ");
  const experience = [...text.matchAll(/(\d{1,2})\s*(?:[–—-]\s*(\d{1,2}))?\s*\+?\s*years?\b/giu)]
    .map((found) => ({ floor: Number(found[1]), ceiling: found[2] ? Number(found[2]) : null, context: text.slice(Math.max(0, found.index - 70), Math.min(text.length, found.index + found[0].length + 100)), index: found.index, length: found[0].length }))
    .filter((item) => {
      const after = text.slice(item.index + item.length, item.index + item.length + 65).split(/[.;\n]/u)[0];
      const before = text.slice(Math.max(0, item.index - 70), item.index).split(/[.;\n]/u).at(-1) ?? "";
      return !/prefer|nice to have|bonus|optional/iu.test(`${before} ${after}`)
        && !/company|founded|in business|serving customers/iu.test(before)
        && /experience|require|minimum|at least|you (?:have|bring)|qualification/iu.test(`${before} ${after}`);
    });
  const floors = [...new Set(experience.map((item) => item.floor))];
  if (!experience.length || floors.length !== 1) add("hold", "experience_unclear", "description", experience.map((item) => item.context).join(" | ").slice(0, 500) || "No clear numeric experience requirement");
  else if (floors[0] >= 7 && /minimum|at least|require/iu.test(experience[0].context)) add("exclude", "experience_requirement_too_high", "description", experience[0].context);
  else if (floors[0] >= 5) add("hold", "experience_floor_review", "description", experience[0].context);
  else evidence.push({ field: "description", value: experience[0].context, reason: "experience_range_signal" });

  return {
    ...posting, previously_recommended: dates.length > 0, recommended_run_dates: dates,
    screening: { status: exclude.length ? "excluded" : hold.length ? "hold" : "candidate", reasons: [...exclude, ...hold], evidence },
  };
}

function increment(counts: Record<string, number>, reason: string) { counts[reason] = (counts[reason] ?? 0) + 1; }

/** Pure public-data merge. History is read-only and mandatory, even for cached re-screening. */
export function updatePool(previous: DiscoveryPool | null, results: SourceScanResult[], rawHistory: RecommendationHistory, now: Date): { pool: DiscoveryPool; queue: DiscoveryQueue; metrics: DiscoveryMetrics } {
  const history = parseRecommendationHistory(rawHistory, now);
  const canonicalHistory = { ...history, jobs: history.jobs.map((job) => ({ ...job, source_url: canonicalHistoryUrl(job.source_url) })) };
  const stamp = now.toISOString();
  const prior = previous === null ? null : parsePool(previous);
  if (prior && Date.parse(prior.updated_at) > now.getTime()) throw new Error("Pool timestamp is from the future");
  const postings = new Map((prior?.postings ?? []).map((posting) => [posting.key, { ...posting }]));
  const sources = new Map((prior?.sources ?? []).map((source) => [source.source_id, { ...source }]));
  const metrics: DiscoveryMetrics = {
    scanned_boards: results.length, successful_boards: 0, failed_boards: 0, raw_retrieved: 0, relevant_retrieved: 0,
    first_discovered: 0, active: 0, new_recommendation_candidates: 0, repeat_candidates: 0, held: 0, excluded: 0,
    exclusion_reasons: {}, hold_reasons: {},
  };
  const scanned = new Set<string>();
  for (const result of results) {
    if (scanned.has(result.source_id)) throw new Error("Duplicate source scan");
    scanned.add(result.source_id);
    if (!result.source_id || typeof result.success !== "boolean" || !Number.isSafeInteger(result.total_count) || result.total_count < 0) throw new Error("Invalid source scan");
    metrics.raw_retrieved += result.postings.length;
    const oldSource = sources.get(result.source_id);
    sources.set(result.source_id, { source_id: result.source_id, success: result.success, last_checked_at: stamp, last_successful_scan_at: result.success ? stamp : oldSource?.last_successful_scan_at ?? null });
    if (!result.success) {
      metrics.failed_boards += 1;
      for (const posting of postings.values()) if (posting.source_id === result.source_id) {
        posting.last_checked_at = stamp;
        if (posting.availability !== "missing") posting.availability = "unverified";
      }
      continue;
    }
    if (result.total_count !== result.postings.length) throw new Error("Incomplete successful source scan");
    metrics.successful_boards += 1;
    const seen = new Set<string>();
    for (const rawPosting of result.postings) {
      const posting = postingSchema.parse(rawPosting);
      if (posting.source_id !== result.source_id) throw new Error("Posting source does not match its scan");
      if (seen.has(posting.key)) throw new Error("Duplicate posting identity in source scan");
      seen.add(posting.key);
      const priorPosting = postings.get(posting.key);
      if (priorPosting && priorPosting.source_id !== posting.source_id) throw new Error("Posting identity belongs to another source");
      if (!isRelevant(posting)) {
        if (priorPosting) {
          postings.set(posting.key, { ...posting, first_seen_at: priorPosting.first_seen_at, last_seen_at: stamp, last_checked_at: stamp, availability: "active" });
        } else {
          increment(metrics.exclusion_reasons, "unrelated_role");
          metrics.excluded += 1;
        }
        continue;
      }
      metrics.relevant_retrieved += 1;
      if (!priorPosting) metrics.first_discovered += 1;
      postings.set(posting.key, { ...posting, first_seen_at: priorPosting?.first_seen_at ?? stamp, last_seen_at: stamp, last_checked_at: stamp, availability: "active" });
    }
    for (const posting of postings.values()) if (posting.source_id === result.source_id && !seen.has(posting.key)) {
      posting.last_checked_at = stamp;
      posting.availability = "missing";
    }
  }
  const pool: DiscoveryPool = { schema_version: 1, updated_at: stamp, sources: [...sources.values()].sort((a, b) => a.source_id.localeCompare(b.source_id)), postings: [...postings.values()].sort((a, b) => a.key.localeCompare(b.key)) };
  const queue: DiscoveryQueue = { schema_version: 1, generated_at: stamp, history_generated_at: history.generated_at, candidates: [], review_holds: [] };
  for (const posting of pool.postings) {
    if (posting.availability === "active") metrics.active += 1;
    const entry = screen(posting, sources.get(posting.source_id), canonicalHistory, now);
    if (entry.screening.status === "excluded") {
      metrics.excluded += 1;
      for (const reason of entry.screening.reasons) increment(metrics.exclusion_reasons, reason);
    } else if (entry.screening.status === "hold") {
      queue.review_holds.push(entry);
      metrics.held += 1;
      for (const reason of entry.screening.reasons) increment(metrics.hold_reasons, reason);
    } else {
      queue.candidates.push(entry);
      if (entry.previously_recommended) metrics.repeat_candidates += 1;
      else metrics.new_recommendation_candidates += 1;
    }
  }
  const order = (a: DiscoveryQueueEntry, b: DiscoveryQueueEntry) => Number(a.previously_recommended) - Number(b.previously_recommended) || b.first_seen_at.localeCompare(a.first_seen_at) || a.key.localeCompare(b.key);
  queue.candidates.sort(order);
  queue.review_holds.sort(order);
  return { pool, queue, metrics };
}
