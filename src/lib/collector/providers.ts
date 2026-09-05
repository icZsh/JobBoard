import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import type { CollectorPosting, CollectorSource, DateEvidence, JsonFetcher, RemoteType } from "./types";

const text = z.string().nullish();
const nonempty = z.string().trim().min(1);
const publicUrl = nonempty.refine((value) => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, "Expected an HTTP(S) posting URL");
const salaryComponent = z.object({
  compensationType: nonempty, interval: text, currencyCode: text,
  minValue: z.number().finite().nullish(), maxValue: z.number().finite().nullish(),
});
const ashbySchema = z.object({
  id: nonempty.optional(), title: nonempty, isListed: z.boolean(), jobUrl: publicUrl, applyUrl: publicUrl.nullish(),
  descriptionPlain: text, descriptionHtml: text,
  location: text, secondaryLocations: z.array(z.object({ location: text })).nullish(),
  address: z.object({ postalAddress: z.object({ addressCountry: text }).nullish() }).nullish(),
  isRemote: z.boolean().nullish(), workplaceType: text, employmentType: text, publishedAt: text,
  compensation: z.object({
    compensationTiers: z.array(z.object({ components: z.array(salaryComponent) })).nullish(),
    summaryComponents: z.array(salaryComponent).nullish(),
  }).nullish(),
}).refine((job) => Boolean(job.descriptionPlain?.trim() || job.descriptionHtml?.trim()), "Missing job description");
const greenhouseSchema = z.object({
  id: z.number().int().positive().safe(), title: nonempty, absolute_url: publicUrl, content: nonempty,
  location: z.object({ name: text }).nullish(),
  offices: z.array(z.object({ location: text })).nullish(),
  first_published: text, updated_at: text,
});
const leverSchema = z.object({
  id: nonempty, text: nonempty, hostedUrl: publicUrl, applyUrl: publicUrl.nullish(),
  descriptionPlain: text, description: text,
  lists: z.array(z.object({ text: z.string(), content: z.string() })).nullish(),
  additionalPlain: text, additional: text, salaryDescriptionPlain: text, salaryDescription: text,
  categories: z.object({ location: text, allLocations: z.array(z.string()).nullish(), commitment: text }),
  country: text, workplaceType: text, createdAt: z.number().finite().nullish(),
  salaryRange: z.object({ currency: text, interval: text, min: z.number().finite().nullish(), max: z.number().finite().nullish() }).nullish(),
}).refine((job) => Boolean(job.descriptionPlain?.trim() || job.description?.trim() || job.lists?.some((list) => list.content.trim())), "Missing job description");

function decodeSerializedText(value: string): string {
  // sanitize-html decodes the full HTML entity set, then escapes these output characters.
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function plainText(value: string): string {
  let result = value;
  // Greenhouse often entity-encodes the HTML itself. Decode and strip that layer too.
  for (let pass = 0; pass < 4; pass++) {
    result = decodeSerializedText(sanitizeHtml(result.replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|br|section|tr)\b[^>]*>/gi, "\n"), {
      allowedTags: [], allowedAttributes: {},
    }));
    if (!/<\/?[a-z][^>]*>/i.test(result) && !/&(?:lt|gt|amp);/.test(result)) break;
  }
  return result.replace(/\r/g, "").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
}

function locations(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function remoteType(value: string | null | undefined): RemoteType {
  switch (value?.toLowerCase()) {
    case "remote": return "remote";
    case "hybrid": return "hybrid";
    case "onsite": case "on-site": return "onsite";
    default: return null;
  }
}

function date(value: string | number | null | undefined, warnings: string[], field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    // Date.parse normalizes impossible dates such as February 30. Reject those first.
    const day = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    const year = Number(day?.[1]);
    const month = Number(day?.[2]);
    const dayNumber = Number(day?.[3]);
    if (!day || month < 1 || month > 12 || dayNumber < 1 || dayNumber > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
      warnings.push(`Invalid provider ${field}; date left unknown.`);
      return null;
    }
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    warnings.push(`Invalid provider ${field}; date left unknown.`);
    return null;
  }
  return parsed.toISOString();
}

function basePosting(source: CollectorSource, externalId: string, title: string, sourceUrl: string, description: string): CollectorPosting {
  return {
    provider: source.provider, board: source.board, externalId, title: plainText(title), company: source.company,
    companyWebsiteUrl: source.websiteUrl, locations: [], country: null, remoteType: null, employmentType: null,
    description, sourceUrl, salaryMin: null, salaryMax: null, datePosted: null, dateEvidence: "unknown", sourceUpdatedAt: null, warnings: [],
  };
}

function setDate(posting: CollectorPosting, value: string | number | null | undefined, evidence: DateEvidence, field: string) {
  posting.datePosted = date(value, posting.warnings, field)?.slice(0, 10) ?? null;
  posting.dateEvidence = posting.datePosted === null ? "unknown" : evidence;
}

function validRange(min: number | null | undefined, max: number | null | undefined): boolean {
  return typeof min === "number" && typeof max === "number" && Number.isSafeInteger(min) && Number.isSafeInteger(max) && min > 0 && max >= min;
}

function ashbyPosting(source: CollectorSource, raw: z.infer<typeof ashbySchema>): CollectorPosting {
  // The documented API does not guarantee id. The hosted posting path also contains its stable ID.
  const id = raw.id ?? new URL(raw.jobUrl).pathname.split("/").filter(Boolean).at(-1);
  if (!id || new URL(raw.jobUrl).pathname.split("/").filter(Boolean).length < 2) throw new Error("Ashby posting has no stable identity");
  const posting = basePosting(source, id, raw.title, raw.applyUrl ?? raw.jobUrl, plainText(raw.descriptionPlain || raw.descriptionHtml || ""));
  posting.locations = locations([raw.location, ...(raw.secondaryLocations ?? []).map((item) => item.location)]);
  posting.country = raw.address?.postalAddress?.addressCountry?.trim() || null;
  posting.remoteType = remoteType(raw.workplaceType) ?? (raw.isRemote === true ? "remote" : null);
  posting.employmentType = raw.employmentType || null;
  setDate(posting, raw.publishedAt, "last_published", "publishedAt (last publication)");
  if (raw.compensation) {
    const tiers = raw.compensation.compensationTiers;
    if (tiers && tiers.length > 1) {
      posting.warnings.push("Salary has multiple compensation tiers; no location-specific annual base range selected.");
    } else {
      const components = tiers?.length === 1 ? tiers[0].components : raw.compensation.summaryComponents ?? [];
      const salaries = components.filter((item) => item.compensationType === "Salary");
      const salary = salaries[0];
      if (salaries.length === 1 && salary.currencyCode === "USD" && salary.interval === "1 YEAR" && validRange(salary.minValue, salary.maxValue)) {
        posting.salaryMin = salary.minValue!;
        posting.salaryMax = salary.maxValue!;
      } else if (salaries.length) {
        posting.warnings.push("Salary is not one explicit annual USD base range; values left unknown.");
      }
    }
  }
  return posting;
}

function greenhousePosting(source: CollectorSource, raw: z.infer<typeof greenhouseSchema>): CollectorPosting {
  const posting = basePosting(source, String(raw.id), raw.title, raw.absolute_url, plainText(raw.content));
  posting.locations = locations([raw.location?.name, ...(raw.offices ?? []).map((office) => office.location)]);
  setDate(posting, raw.first_published, "first_published", "first_published");
  posting.sourceUpdatedAt = date(raw.updated_at, posting.warnings, "updated_at");
  // List content and pay transparency fields do not guarantee annual base compensation.
  return posting;
}

function leverPosting(source: CollectorSource, raw: z.infer<typeof leverSchema>): CollectorPosting {
  const salaryDescription = plainText(raw.salaryDescriptionPlain || raw.salaryDescription || "");
  const description = [
    plainText(raw.descriptionPlain || raw.description || ""),
    ...(raw.lists ?? []).map((list) => plainText(`${list.text}\n${list.content}`)),
    plainText(raw.additionalPlain || raw.additional || ""), salaryDescription,
  ].filter(Boolean).join("\n\n");
  const posting = basePosting(source, raw.id, raw.text, raw.applyUrl ?? raw.hostedUrl, description);
  posting.locations = locations([raw.categories.location, ...(raw.categories.allLocations ?? [])]);
  posting.country = raw.country?.trim() || null;
  posting.remoteType = remoteType(raw.workplaceType);
  posting.employmentType = raw.categories.commitment || null;
  setDate(posting, raw.createdAt, "created", "createdAt");
  if (raw.salaryRange) {
    const salary = raw.salaryRange;
    const explicitBase = /\bbase\s+(?:salary|pay)\b/i.test(salaryDescription) && !/\b(?:total\s+compensation|on.target\s+earnings|OTE)\b/i.test(salaryDescription);
    if (salary.currency === "USD" && salary.interval === "per-year-salary" && explicitBase && validRange(salary.min, salary.max)) {
      posting.salaryMin = salary.min!;
      posting.salaryMax = salary.max!;
    } else {
      posting.warnings.push("Salary range does not explicitly establish annual USD base pay; values left unknown.");
    }
  }
  return posting;
}

function uniquePostings(postings: CollectorPosting[]): CollectorPosting[] {
  const ids = new Set<string>();
  for (const posting of postings) {
    if (ids.has(posting.externalId)) throw new Error(`Duplicate posting ID ${posting.externalId}; source may have changed during pagination`);
    ids.add(posting.externalId);
    if (!posting.title || !posting.description) throw new Error(`Posting ${posting.externalId} has an empty title or description after sanitization`);
  }
  return postings;
}

/** Returns a complete validated source or throws; partial pages never imply feed completeness. */
export async function fetchSource(source: CollectorSource, fetchJson: JsonFetcher): Promise<CollectorPosting[]> {
  const board = encodeURIComponent(source.board);
  switch (source.provider) {
    case "ashby": {
      const response = z.object({ jobs: z.array(ashbySchema) }).parse(await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`));
      return uniquePostings(response.jobs.filter((job) => job.isListed).map((job) => ashbyPosting(source, job)));
    }
    case "greenhouse": {
      const response = z.object({ jobs: z.array(greenhouseSchema), meta: z.object({ total: z.number().int().nonnegative() }).optional() }).parse(await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`));
      if (response.meta && response.meta.total !== response.jobs.length) throw new Error("Greenhouse total does not match returned jobs; source is incomplete");
      return uniquePostings(response.jobs.map((job) => greenhousePosting(source, job)));
    }
    case "lever": {
      const postings: CollectorPosting[] = [];
      const ids = new Set<string>();
      const limit = 100;
      // A hard limit prevents a broken server's pagination from making this run unbounded.
      for (let page = 0; page < 1000; page++) {
        const jobs = z.array(leverSchema).max(limit).parse(await fetchJson(`https://api.lever.co/v0/postings/${board}?mode=json&skip=${page * limit}&limit=${limit}`));
        for (const job of jobs) {
          if (ids.has(job.id)) throw new Error(`Duplicate Lever posting ID ${job.id}; source changed during pagination`);
          ids.add(job.id);
          postings.push(leverPosting(source, job));
        }
        if (jobs.length < limit) return uniquePostings(postings);
      }
      throw new Error("Lever pagination exceeded 1000 pages; source is incomplete");
    }
  }
}
