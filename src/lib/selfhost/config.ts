import { z } from "zod";
import initialSources from "../../../config/collector/sources.json";
import { defaultRules, parseConfig } from "../collector/config";
import type { CollectorConfig, CollectorSource } from "../collector/types";

const shortText = z.string().trim().min(1).max(100);
export const preferencesSchema = z
  .strictObject({
    cities: z.array(shortText).max(30),
    usRemote: z.boolean(),
    roles: z.array(shortText).min(1).max(30),
    excludedTitles: z.array(shortText).max(30),
    skills: z.array(shortText).max(100),
    minExperienceYears: z.number().int().min(0).max(30),
    maxExperienceYears: z.number().int().min(0).max(30),
    preferredSalaryMin: z.number().int().min(0).max(10000000),
    maxPostingAgeDays: z.number().int().min(1).max(365),
    maxResults: z.number().int().min(1).max(100),
    allowUnknownDate: z.boolean(),
  })
  .refine(
    (value) => value.maxExperienceYears >= value.minExperienceYears,
    "Maximum experience must be at least minimum experience.",
  )
  .refine(
    (value) => value.usRemote || value.cities.length > 0,
    "Select US remote or at least one US city.",
  );

export type CollectionPreferences = z.infer<typeof preferencesSchema>;
export interface SelfHostConfig {
  timezone: string;
  schedule: { enabled: boolean; time: string };
  preferences: CollectionPreferences;
  collector: CollectorConfig;
}

const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }, "Enter a valid IANA timezone, such as America/New_York.");
const scheduleSchema = z.strictObject({
  enabled: z.boolean(),
  time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "Select a valid daily time."),
});
const settingsSchema = z.strictObject({
  timezone: timezoneSchema,
  schedule: scheduleSchema,
  preferences: preferencesSchema,
});

export const defaultPreferences: CollectionPreferences = {
  cities: [
    "New York",
    "San Francisco",
    "San Mateo",
    "San Jose",
    "Palo Alto",
    "Mountain View",
    "Oakland",
  ],
  usRemote: true,
  roles: [
    "Data Engineer",
    "Analytics Engineer",
    "BI Engineer",
    "BI Developer",
    "Data Platform Engineer",
    "Data Infrastructure Engineer",
    "Software Engineer Data",
    "Software Engineer Infrastructure",
    "ML Platform Engineer",
  ],
  excludedTitles: [
    "Senior",
    "Sr",
    "Staff",
    "Principal",
    "Lead",
    "Manager",
    "Director",
    "Head",
    "VP",
    "Intern",
    "Internship",
    "Contract",
    "Contractor",
    "Junior",
    "New Grad",
  ],
  skills: defaultRules.skills,
  minExperienceYears: 2,
  maxExperienceYears: 5,
  preferredSalaryMin: 160000,
  maxPostingAgeDays: 30,
  maxResults: 12,
  allowUnknownDate: true,
};

function escapePattern(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function literalPhrase(text: string) {
  return `\\b${text.split(/\s+/u).map(escapePattern).join("[\\s,/():-]+")}\\b`;
}

function buildCollector(
  preferences: CollectionPreferences,
  sources: unknown,
  request?: unknown,
): CollectorConfig {
  return parseConfig({
    version: 1,
    sources,
    ...(request ? { request } : {}),
    rules: {
      ...defaultRules,
      includeTitlePatterns: preferences.roles.map(literalPhrase),
      excludeTitlePatterns: preferences.excludedTitles.map(literalPhrase),
      locationPatterns: preferences.cities.map(
        (city) =>
          `${literalPhrase(city)}${/^new york$/iu.test(city) ? "(?!\\s+(?:state|mills|england))" : ""}`,
      ),
      usRemotePatterns: preferences.usRemote
        ? defaultRules.usRemotePatterns
        : [],
      skills: preferences.skills,
      minExperienceYears: preferences.minExperienceYears,
      maxExperienceYears: preferences.maxExperienceYears,
      preferredSalaryMin: preferences.preferredSalaryMin,
      maxPostingAgeDays: preferences.maxPostingAgeDays,
      maxResults: preferences.maxResults,
      allowUnknownDate: preferences.allowUnknownDate,
    },
  });
}

export function defaultSelfHostConfig(): SelfHostConfig {
  return {
    timezone: "UTC",
    schedule: { enabled: true, time: "09:00" },
    preferences: structuredClone(defaultPreferences),
    collector: buildCollector(defaultPreferences, initialSources),
  };
}

/** Accept only documented hosted ATS boards; never fetch a supplied URL. */
export function sourceFromAtsUrl(
  value: string,
  company: string,
  enabled = true,
): CollectorSource {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTPS ATS board URL without credentials, query parameters, or fragments.",
    );
  const provider =
    url.hostname === "jobs.ashbyhq.com"
      ? "ashby"
      : ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(
            url.hostname,
          )
        ? "greenhouse"
        : url.hostname === "jobs.lever.co"
          ? "lever"
          : null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    !provider ||
    parts.length !== 1 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(parts[0])
  )
    throw new Error(
      "Use a supported company board URL: jobs.ashbyhq.com/company, job-boards.greenhouse.io/company, or jobs.lever.co/company.",
    );
  const template = initialSources.find(
    (source) =>
      source.provider === provider &&
      source.board.toLowerCase() === parts[0].toLowerCase(),
  );
  return {
    provider,
    board: parts[0],
    company: shortText.parse(company),
    websiteUrl: template?.websiteUrl ?? null,
    enabled,
  };
}

export function atsUrlForSource(source: CollectorSource): string {
  const host =
    source.provider === "ashby"
      ? "jobs.ashbyhq.com"
      : source.provider === "greenhouse"
        ? "job-boards.greenhouse.io"
        : "jobs.lever.co";
  return `https://${host}/${source.board}`;
}

export function parseSelfHostInput(value: unknown): SelfHostConfig {
  const input = z
    .strictObject({
      timezone: timezoneSchema,
      schedule: scheduleSchema,
      preferences: preferencesSchema,
      sources: z
        .array(
          z.strictObject({
            company: shortText,
            atsUrl: z.string().max(500),
            enabled: z.boolean(),
          }),
        )
        .min(1)
        .max(100),
    })
    .parse(value);
  const sources = input.sources.map((source) =>
    sourceFromAtsUrl(source.atsUrl, source.company, source.enabled),
  );
  if (!sources.some((source) => source.enabled))
    throw new Error("Enable at least one company.");
  return {
    timezone: input.timezone,
    schedule: input.schedule,
    preferences: input.preferences,
    collector: buildCollector(input.preferences, sources),
  };
}

export function parseSelfHostConfig(value: unknown): SelfHostConfig {
  const input = z
    .strictObject({
      timezone: timezoneSchema,
      schedule: scheduleSchema,
      preferences: preferencesSchema,
      collector: z.unknown(),
    })
    .parse(value);
  const collector = parseConfig(input.collector);
  // Saved/queued snapshots must retain the exact rules selected when created.
  // Only the web-input parser regenerates rules from editable preferences.
  return {
    ...settingsSchema.parse({
      timezone: input.timezone,
      schedule: input.schedule,
      preferences: input.preferences,
    }),
    collector,
  };
}

export async function getCollectionConfig(): Promise<SelfHostConfig | null> {
  const { prisma } = await import("../prisma");
  const saved = await prisma.collectionConfig.findUnique({
    where: { id: "default" },
  });
  return saved ? parseSelfHostConfig(saved.value) : null;
}
