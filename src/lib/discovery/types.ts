export type AtsProvider = "ashby" | "greenhouse" | "lever";

export type DiscoverySource = {
  id: string;
  provider: AtsProvider;
  board: string;
  company: string;
  evidence_url: string;
  enabled: boolean;
  exclusion_reason?: string;
};

export type DiscoveryRegistry = { schema_version: 1; sources: DiscoverySource[] };

/** Public employer data only. Publication signals are not proof of an original posting date. */
export type DiscoveryPosting = {
  key: string;
  source_id: string;
  provider: AtsProvider;
  external_id: string;
  company: string;
  title: string;
  location: string;
  source_url: string;
  description: string;
  employment_type: string | null;
  workplace_type: string | null;
  published_at: string | null;
  published_at_kind: "last_published" | "created" | "unknown";
};

/** A failed or incomplete board fetch must never close its previously seen jobs. */
export type SourceScanResult = {
  source_id: string;
  success: boolean;
  postings: DiscoveryPosting[];
  total_count: number;
  error?: string;
};
