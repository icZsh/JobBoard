import sanitizeHtml from "sanitize-html";
import type { AtsProvider, DiscoveryPosting, DiscoveryRegistry, DiscoverySource, SourceScanResult } from "./types";

const MAX_SOURCE_MS = 15_000;
const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
const LEVER_PAGE_SIZE = 100;
const MAX_LEVER_PAGES = 100;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,149}$/;
const POSTING_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,149}$/;
const HOST_PROVIDER: Record<string, AtsProvider> = {
  "jobs.ashbyhq.com": "ashby",
  "boards.greenhouse.io": "greenhouse",
  "job-boards.greenhouse.io": "greenhouse",
  "jobs.lever.co": "lever",
  "jobs.eu.lever.co": "lever",
};

type JsonObject = Record<string, unknown>;
function object(raw: unknown, context: string): JsonObject {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Malformed ${context}: expected object`);
  return raw as JsonObject;
}
function string(raw: unknown, context: string, empty = false): string {
  if (typeof raw !== "string" || (!empty && !raw.trim())) throw new Error(`Malformed ${context}: expected text`);
  return raw;
}
function optionalString(raw: unknown, context: string): string | null {
  return raw == null ? null : string(raw, context, true);
}
function array(raw: unknown, context: string): unknown[] {
  if (!Array.isArray(raw)) throw new Error(`Malformed ${context}: expected list`);
  return raw;
}
function validSlug(value: string): boolean {
  return SLUG.test(value) && value.trim() === value && !value.includes("..");
}
function officialUrl(raw: string): { url: URL; provider: AtsProvider; board: string; parts: string[] } | null {
  try {
    // Reject backslashes before URL normalization can interpret them as separators.
    if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
    const url = new URL(raw);
    if (!Object.hasOwn(HOST_PROVIDER, url.hostname)) return null;
    const provider = HOST_PROVIDER[url.hostname];
    if (!provider || url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
    if (provider === "greenhouse" && parts[0] === "embed") {
      if (!["job_app", "job_board"].includes(parts[1]) || parts.slice(2).some(Boolean)) return null;
      const embeddedBoard = url.searchParams.get("for");
      if (!embeddedBoard || !validSlug(embeddedBoard)) return null;
      return { url, provider, board: embeddedBoard, parts: [embeddedBoard] };
    }
    if (!parts[0] || !validSlug(parts[0])) return null;
    return { url, provider, board: parts[0], parts };
  } catch { return null; }
}

/** Seed a source only from evidence on a supported public employer ATS domain. */
export function sourceFromPostingUrl(company: string, url: string): DiscoverySource | null {
  if (typeof company !== "string" || !company.trim() || company.length > 300 || typeof url !== "string") return null;
  const parsed = officialUrl(url);
  if (!parsed) return null;
  return {
    id: `${parsed.provider}:${parsed.board.toLowerCase()}`,
    provider: parsed.provider,
    board: parsed.board,
    company: company.trim(),
    evidence_url: url,
    enabled: true,
  };
}

function validateSource(raw: unknown): DiscoverySource {
  const value = object(raw, "source");
  const company = string(value.company, "company");
  const evidence = string(value.evidence_url, "evidence URL");
  const derived = sourceFromPostingUrl(company, evidence);
  if (!derived || derived.provider !== value.provider || derived.board.toLowerCase() !== string(value.board, "board").toLowerCase()
      || !validSlug(value.board as string) || derived.id !== value.id || typeof value.enabled !== "boolean") {
    throw new Error("Invalid source: provider, board, id and official HTTPS evidence must match");
  }
  const exclusion = optionalString(value.exclusion_reason, "exclusion reason");
  return {
    id: derived.id, provider: derived.provider, board: value.board as string,
    company: company.trim(), evidence_url: evidence, enabled: value.enabled,
    ...(exclusion === null ? {} : { exclusion_reason: exclusion }),
  };
}

export function parseRegistry(raw: unknown): DiscoveryRegistry {
  const value = object(raw, "registry");
  if (value.schema_version !== 1) throw new Error("Unsupported discovery registry schema version");
  const sources = array(value.sources, "registry sources").map(validateSource);
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.id)) throw new Error(`Duplicate source: ${source.id}`);
    seen.add(source.id);
  }
  return { schema_version: 1, sources };
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•",
};
function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (original, entity: string) => {
    if (!entity.startsWith("#")) return ENTITIES[entity.toLowerCase()] ?? original;
    const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : " ";
  });
}
function plainText(value: string): string {
  // Greenhouse content can have multiple layers of HTML entity encoding.
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntities(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  const spaced = decoded.replace(/<\/?(?:p|div|li|br|h[1-6]|section|ul|ol|table|tr)\b[^>]*>/gi, "\n");
  return decodeEntities(sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} }))
    .replace(/[\t\r ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function combine(values: Array<string | null | undefined>): string {
  return [...new Set(values.filter((v): v is string => Boolean(v?.trim())).map((v) => plainText(v!)))].filter(Boolean).join("; ");
}
function addressParts(raw: unknown, context: string): string[] {
  if (raw == null) return [];
  const address = object(raw, context);
  return ["addressLocality", "addressRegion", "addressCountry"].map((key) => optionalString(address[key], `${context}.${key}`)).filter((v): v is string => Boolean(v));
}
function isoDate(raw: unknown, context: string): string | null {
  if (raw == null || raw === "") return null;
  const value = string(raw, context);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Malformed ${context}: invalid timestamp`);
  return new Date(value).toISOString();
}
function basePosting(source: DiscoverySource, id: string, title: string): DiscoveryPosting {
  if (!POSTING_ID.test(id)) throw new Error("Malformed posting identity");
  const board = encodeURIComponent(source.board);
  const leverHost = new URL(source.evidence_url).hostname === "jobs.eu.lever.co" ? "jobs.eu.lever.co" : "jobs.lever.co";
  const sourceUrl = source.provider === "ashby" ? `https://jobs.ashbyhq.com/${board}/${id}`
    : source.provider === "greenhouse" ? `https://job-boards.greenhouse.io/${board}/jobs/${id}`
      : `https://${leverHost}/${board}/${id}`;
  return {
    key: `${source.provider}:${id}`, source_id: source.id, provider: source.provider, external_id: id,
    company: source.company, title: plainText(title), location: "", source_url: sourceUrl, description: "",
    employment_type: null, workplace_type: null, published_at: null, published_at_kind: "unknown",
  };
}
function ashbyPosting(source: DiscoverySource, raw: unknown): DiscoveryPosting | null {
  const value = object(raw, "Ashby posting");
  const title = string(value.title, "Ashby title");
  const jobUrl = officialUrl(string(value.jobUrl, "Ashby jobUrl"));
  if (!jobUrl || jobUrl.provider !== "ashby" || jobUrl.board.toLowerCase() !== source.board.toLowerCase()
      || !jobUrl.parts[1] || !POSTING_ID.test(jobUrl.parts[1]) || jobUrl.parts.slice(2).some(Boolean)) {
    throw new Error("Malformed Ashby posting URL: board or posting identity does not match");
  }
  const row = basePosting(source, jobUrl.parts[1], title);
  if (typeof value.isListed !== "boolean") throw new Error("Malformed Ashby isListed");
  if (value.isRemote != null && typeof value.isRemote !== "boolean") throw new Error("Malformed Ashby isRemote");
  const location = string(value.location, "Ashby location", true);
  const address = value.address == null ? null : object(value.address, "Ashby address");
  const locations = [location, ...addressParts(address?.postalAddress, "Ashby postalAddress")];
  if (value.secondaryLocations != null) {
    for (const rawLocation of array(value.secondaryLocations, "Ashby secondaryLocations")) {
      const secondary = object(rawLocation, "Ashby secondary location");
      locations.push(string(secondary.location, "Ashby secondary location name", true), ...addressParts(secondary.address, "Ashby secondary address"));
    }
  }
  row.location = combine(locations);
  const description = value.descriptionPlain ?? value.descriptionHtml;
  row.description = plainText(string(description, "Ashby description", true));
  row.employment_type = optionalString(value.employmentType, "Ashby employmentType");
  row.workplace_type = optionalString(value.workplaceType, "Ashby workplaceType") ?? (value.isRemote === true ? "Remote" : null);
  row.published_at = isoDate(value.publishedAt, "Ashby publishedAt");
  row.published_at_kind = row.published_at ? "last_published" : "unknown";
  return value.isListed ? row : null;
}
function greenhousePosting(source: DiscoverySource, raw: unknown): DiscoveryPosting {
  const value = object(raw, "Greenhouse posting");
  if (!Number.isSafeInteger(value.id) || (value.id as number) <= 0) throw new Error("Malformed Greenhouse posting id");
  const row = basePosting(source, String(value.id), string(value.title, "Greenhouse title"));
  const location = object(value.location, "Greenhouse location");
  const locations = [string(location.name, "Greenhouse location name", true)];
  if (value.offices != null) {
    for (const rawOffice of array(value.offices, "Greenhouse offices")) {
      const office = object(rawOffice, "Greenhouse office");
      const officeLocation = optionalString(office.location, "Greenhouse office location");
      if (officeLocation) locations.push(officeLocation);
    }
  }
  row.location = combine(locations);
  row.description = plainText(string(value.content, "Greenhouse full content", true));
  // The list API's updated_at describes an edit, not initial publication.
  return row;
}
function leverPosting(source: DiscoverySource, raw: unknown): DiscoveryPosting {
  const value = object(raw, "Lever posting");
  const row = basePosting(source, string(value.id, "Lever id"), string(value.text, "Lever title"));
  const categories = object(value.categories, "Lever categories");
  const locations: Array<string | null> = [string(categories.location, "Lever location", true), optionalString(value.country, "Lever country")];
  if (categories.allLocations != null) locations.push(...array(categories.allLocations, "Lever allLocations").map((v) => string(v, "Lever location entry", true)));
  row.location = combine(locations);
  const paragraphs = [plainText(string(value.descriptionPlain ?? value.description, "Lever description", true))];
  for (const list of array(value.lists, "Lever lists")) {
    const section = object(list, "Lever list section");
    paragraphs.push(plainText(string(section.text, "Lever list title", true)), plainText(string(section.content, "Lever list content", true)));
  }
  for (const part of [value.additionalPlain ?? value.additional, value.salaryDescriptionPlain ?? value.salaryDescription]) {
    if (part != null) paragraphs.push(plainText(string(part, "Lever closing content", true)));
  }
  row.description = paragraphs.filter(Boolean).join("\n\n");
  row.employment_type = optionalString(categories.commitment, "Lever commitment");
  row.workplace_type = optionalString(value.workplaceType, "Lever workplaceType");
  if (value.createdAt != null) {
    if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt) || value.createdAt < 0 || !Number.isFinite(new Date(value.createdAt).getTime())) throw new Error("Malformed Lever createdAt");
    row.published_at = new Date(value.createdAt).toISOString();
    row.published_at_kind = "created";
  }
  return row;
}

/** Strict complete-response parsing: one malformed row fails the entire board. */
export function parsePostings(source: DiscoverySource, raw: unknown): DiscoveryPosting[] {
  source = validateSource(source);
  let postings: DiscoveryPosting[];
  if (source.provider === "ashby") {
    const value = object(raw, "Ashby response");
    if (value.apiVersion !== "1") throw new Error("Unsupported Ashby response version");
    postings = array(value.jobs, "Ashby jobs").map((v) => ashbyPosting(source, v)).filter((v): v is DiscoveryPosting => v !== null);
  } else if (source.provider === "greenhouse") {
    const value = object(raw, "Greenhouse response");
    const jobs = array(value.jobs, "Greenhouse jobs");
    const meta = object(value.meta, "Greenhouse meta");
    if (!Number.isSafeInteger(meta.total) || meta.total !== jobs.length) throw new Error("Incomplete Greenhouse response: total does not match jobs");
    postings = jobs.map((v) => greenhousePosting(source, v));
  } else {
    postings = array(raw, "Lever response").map((v) => leverPosting(source, v));
  }
  const seen = new Set<string>();
  for (const row of postings) {
    if (seen.has(row.key)) throw new Error(`Duplicate posting identity: ${row.key}`);
    seen.add(row.key);
  }
  return postings;
}

export async function fetchSource(source: DiscoverySource, options: { fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<SourceScanResult> {
  const failure = (error: string): SourceScanResult => ({ source_id: source.id, success: false, postings: [], total_count: 0, error });
  try {
    source = validateSource(source);
    if (!source.enabled) return failure("Source disabled");
  } catch (error) { return failure(error instanceof Error ? error.message : "Invalid source"); }
  const timeoutMs = Math.min(MAX_SOURCE_MS, options.timeoutMs ?? MAX_SOURCE_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return failure("Invalid source timeout");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bytesRead = 0;
  const fetcher = options.fetcher ?? fetch;
  async function request(url: string): Promise<unknown> {
    if (controller.signal.aborted) throw new Error("ATS source timeout");
    const response = await fetcher(url, { method: "GET", headers: { accept: "application/json" }, credentials: "omit", redirect: "error", signal: controller.signal });
    if (controller.signal.aborted) throw new Error("ATS source timeout");
    if (!response.ok || response.redirected) throw new Error(`ATS HTTP ${response.status}${response.redirected ? " redirect" : ""}`);
    const declaredSize = response.headers.get("content-length");
    if (declaredSize !== null && Number(declaredSize) > MAX_SOURCE_BYTES - bytesRead) throw new Error("ATS response size limit exceeded");
    if (!response.body) throw new Error("Missing ATS response body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw new Error("ATS source timeout");
        if (done) break;
        bytesRead += value.byteLength;
        if (bytesRead > MAX_SOURCE_BYTES) throw new Error("ATS response size limit exceeded");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(body) as unknown;
  }
  async function scan(): Promise<DiscoveryPosting[]> {
    const board = encodeURIComponent(source.board);
    if (source.provider === "ashby") return parsePostings(source, await request(`https://api.ashbyhq.com/posting-api/job-board/${board}`));
    if (source.provider === "greenhouse") return parsePostings(source, await request(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`));
    const host = new URL(source.evidence_url).hostname === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co";
    const all: DiscoveryPosting[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < MAX_LEVER_PAGES; page++) {
      const raw = await request(`https://${host}/v0/postings/${board}?mode=json&limit=${LEVER_PAGE_SIZE}&skip=${page * LEVER_PAGE_SIZE}`);
      const rows = parsePostings(source, raw);
      if (rows.length > LEVER_PAGE_SIZE) throw new Error("Incomplete Lever pagination: limit ignored");
      for (const row of rows) {
        if (seen.has(row.key)) throw new Error("Duplicate posting across Lever pages");
        seen.add(row.key);
        all.push(row);
      }
      if (rows.length < LEVER_PAGE_SIZE) return all;
    }
    throw new Error("Incomplete Lever pagination: page limit exceeded");
  }
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("ATS source timeout")); }, timeoutMs);
    });
    const postings = await Promise.race([scan(), timeout]);
    return { source_id: source.id, success: true, postings, total_count: postings.length };
  } catch (error) {
    return failure(controller.signal.aborted ? "ATS source timeout" : error instanceof Error ? error.message.slice(0, 240) : "ATS source fetch failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
