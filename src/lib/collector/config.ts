import { z } from "zod";
import { sourceKey, type CollectorConfig, type CollectorRules } from "./types";

export const defaultRules: CollectorRules = {
  includeTitlePatterns: [
    "\\b(?:data|analytics)\\s+(?:engineer|developer)\\b",
    "\\b(?:business intelligence|bi)\\s+(?:engineer|developer)\\b",
    "\\bdata[ -](?:platform|infrastructure)[ -]engineer\\b",
    "\\b(?:software|backend|back end|platform)\\s+engineer\\b.*\\b(?:data|infrastructure|infra|analytics|machine learning|ml)\\b",
    "\\b(?:data|infrastructure|infra|analytics|machine learning|ml)\\b.*\\b(?:software|backend|back end|platform)\\s+engineer\\b",
    "\\b(?:machine learning|ml)\\s+(?:platform|infrastructure)\\s+engineer\\b",
    "\\binfrastructure\\s+engineer\\b",
  ],
  excludeTitlePatterns: [
    "\\b(?:senior|sr|staff|principal|lead|manager|director|head|vp|vice president)\\b",
    "\\b(?:intern|internship|contract|contractor|temporary|freelance|apprentice|junior|entry[ -]level)\\b",
    "\\b(?:new[ -]?grad(?:uate)?|graduate)\\b",
  ],
  locationPatterns: [
    "\\bnew york(?: city)?\\b(?!\\s+(?:state|mills|england))",
    "\\bnyc\\b",
    "\\b(?:san francisco|sf bay)\\b|^bay area(?:,\\s*(?:ca|california|usa|united states))?$",
    "\\b(?:san mateo|san jose|oakland|palo alto|menlo park|mountain view|redwood city|sunnyvale|santa clara|foster city|san bruno|berkeley|emeryville|cupertino|fremont|burlingame)\\b",
  ],
  usRemotePatterns: [
    "\\bremote\\b.*\\b(?:united states(?: of america)?|u\\.?s\\.?a?\\.?)(?=$|[\\s,;()/.-])",
    "\\b(?:united states(?: of america)?|u\\.?s\\.?a?\\.?)(?=$|[\\s,;()/.-]).*\\bremote\\b",
  ],
  excludedCompanyPatterns: [],
  skills: ["Python", "SQL", "Spark", "Hive", "dbt", "Airflow", "Snowflake", "BigQuery", "Kafka", "Flink", "AWS", "GCP", "Azure", "Databricks", "Docker", "Kubernetes", "Terraform", "Elasticsearch", "Redshift", "Trino"],
  maxExperienceYears: 5,
  maxPostingAgeDays: 30,
  preferredSalaryMin: 160000,
  minimumScore: 50,
  maxResults: 12,
  allowUnknownDate: true,
};

export const defaultRequest = { timeoutMs: 15000, retries: 2, concurrency: 3 };

const pattern = z.string().trim().min(1).max(500).refine((value) => {
  try { new RegExp(value, "iu"); return true; } catch { return false; }
}, "Invalid regular expression");
const patterns = z.array(pattern).max(100);
const rulesSchema = z.strictObject({
  includeTitlePatterns: patterns.min(1).default(defaultRules.includeTitlePatterns),
  excludeTitlePatterns: patterns.default(defaultRules.excludeTitlePatterns),
  locationPatterns: patterns.default(defaultRules.locationPatterns),
  usRemotePatterns: patterns.default(defaultRules.usRemotePatterns),
  excludedCompanyPatterns: patterns.default(defaultRules.excludedCompanyPatterns),
  skills: z.array(z.string().trim().min(1).max(80)).max(100).default(defaultRules.skills),
  maxExperienceYears: z.number().int().min(0).max(50).default(defaultRules.maxExperienceYears),
  maxPostingAgeDays: z.number().int().min(0).max(3650).default(defaultRules.maxPostingAgeDays),
  preferredSalaryMin: z.number().int().min(0).max(10000000).default(defaultRules.preferredSalaryMin),
  minimumScore: z.number().int().min(0).max(100).default(defaultRules.minimumScore),
  maxResults: z.number().int().min(1).max(500).default(defaultRules.maxResults),
  allowUnknownDate: z.boolean().default(defaultRules.allowUnknownDate),
});
const httpUrl = z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Expected HTTP(S) URL");
const configSchema = z.strictObject({
  version: z.literal(1),
  sources: z.array(z.strictObject({
    provider: z.enum(["ashby", "greenhouse", "lever"]),
    board: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u, "Expected a board slug"),
    company: z.string().trim().min(1).max(200),
    websiteUrl: httpUrl.nullable().default(null),
    enabled: z.boolean().default(true),
  })).min(1).max(500),
  rules: rulesSchema.prefault({}),
  request: z.strictObject({
    timeoutMs: z.number().int().min(100).max(120000).default(defaultRequest.timeoutMs),
    retries: z.number().int().min(0).max(5).default(defaultRequest.retries),
    concurrency: z.number().int().min(1).max(10).default(defaultRequest.concurrency),
  }).prefault({}),
}).superRefine((config, context) => {
  const seen = new Set<string>();
  config.sources.forEach((source, index) => {
    const key = sourceKey(source);
    if (seen.has(key)) context.addIssue({ code: "custom", path: ["sources", index], message: `Duplicate source: ${key}` });
    seen.add(key);
  });
});

export function parseConfig(value: unknown): CollectorConfig {
  return configSchema.parse(value);
}
