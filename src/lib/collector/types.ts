export type Provider = "ashby" | "greenhouse" | "lever";
export type RemoteType = "remote" | "hybrid" | "onsite" | null;
export type DateEvidence = "first_published" | "last_published" | "created" | "unknown";

export interface CollectorSource {
  provider: Provider;
  board: string;
  company: string;
  websiteUrl: string | null;
  enabled: boolean;
}

export interface CollectorPosting {
  provider: Provider;
  board: string;
  externalId: string;
  title: string;
  company: string;
  companyWebsiteUrl: string | null;
  locations: string[];
  country: string | null;
  remoteType: RemoteType;
  employmentType: string | null;
  description: string;
  sourceUrl: string;
  salaryMin: number | null;
  salaryMax: number | null;
  datePosted: string | null;
  dateEvidence: DateEvidence;
  sourceUpdatedAt: string | null;
  warnings: string[];
}

export interface CollectorRules {
  includeTitlePatterns: string[];
  excludeTitlePatterns: string[];
  locationPatterns: string[];
  usRemotePatterns: string[];
  excludedCompanyPatterns: string[];
  skills: string[];
  minExperienceYears?: number;
  maxExperienceYears: number;
  maxPostingAgeDays: number;
  preferredSalaryMin: number;
  minimumScore: number;
  maxResults: number;
  allowUnknownDate: boolean;
}

export interface CollectorConfig {
  version: 1;
  sources: CollectorSource[];
  rules: CollectorRules;
  request: { timeoutMs: number; retries: number; concurrency: number };
}

export interface RuleDecision {
  included: boolean;
  reasons: string[];
  score: number;
  matchedSkills: string[];
  concerns: string[];
}

export interface CollectorImportJob {
  title: string;
  company: string;
  company_website_url: string | null;
  location: string | null;
  remote_type: RemoteType;
  salary_min: number | null;
  salary_max: number | null;
  source_url: string;
  date_posted: string | null;
  description: string;
  fit_score: number;
  priority: "high" | "medium" | "low";
  matched_skills: string[];
  missing_skills: string[];
  match_reason: string;
  concerns: string | null;
  suggested_action: string;
  collector: {
    provider: Provider;
    board: string;
    external_id: string;
    fetched_at: string;
    date_evidence: DateEvidence;
    source_updated_at: string | null;
    scoring: "rules-v1";
  };
}

export interface CollectorPayload {
  run_date: string;
  source_name: "ats_collector_rules_v1";
  jobs: CollectorImportJob[];
}

export type JsonFetcher = (url: string) => Promise<unknown>;

export function sourceKey(source: Pick<CollectorSource, "provider" | "board">) {
  return `${source.provider}:${source.board.toLowerCase()}`;
}

export function postingKey(posting: Pick<CollectorPosting, "provider" | "board" | "externalId">) {
  return `${sourceKey(posting)}:${posting.externalId}`;
}
