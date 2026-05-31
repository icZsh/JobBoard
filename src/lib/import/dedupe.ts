export type DedupeInfo = {
  normalizedSourceUrl: string | null;
  urlKey: string | null;
  fallbackKey: string;
};

export function normalizeTextForDedupe(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
}

export function normalizeSourceUrl(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";

    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
    }

    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase();

      if (
        lowerKey.startsWith("utm_") ||
        [
          "gclid",
          "fbclid",
          "mc_cid",
          "mc_eid",
          "ref",
          "ref_source",
          "source",
        ].includes(lowerKey)
      ) {
        url.searchParams.delete(key);
      }
    }

    const sortedParams = Array.from(url.searchParams.entries()).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    url.search = "";

    for (const [key, paramValue] of sortedParams) {
      url.searchParams.append(key, paramValue);
    }

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/u, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function buildFallbackDedupeKey(input: {
  company: string;
  title: string;
  location?: string | null;
}) {
  return [
    "fallback:",
    normalizeTextForDedupe(input.company),
    "|",
    normalizeTextForDedupe(input.title),
    "|",
    normalizeTextForDedupe(input.location),
  ].join("");
}

export function buildDedupeInfo(input: {
  company: string;
  title: string;
  location?: string | null;
  sourceUrl?: string | null;
}): DedupeInfo {
  const normalizedSourceUrl = normalizeSourceUrl(input.sourceUrl);
  const fallbackKey = buildFallbackDedupeKey(input);

  return {
    normalizedSourceUrl,
    urlKey: normalizedSourceUrl ? `url:${normalizedSourceUrl}` : null,
    fallbackKey,
  };
}

export function dedupeIncomingJobs<T extends { dedupe: DedupeInfo }>(
  items: T[],
): T[] {
  const kept: T[] = [];
  const seenUrlKeys = new Set<string>();
  const firstFallbackByKey = new Map<string, { hasUrl: boolean }>();

  for (const item of items) {
    if (item.dedupe.urlKey && seenUrlKeys.has(item.dedupe.urlKey)) {
      continue;
    }

    const firstFallback = firstFallbackByKey.get(item.dedupe.fallbackKey);

    if (firstFallback) {
      const bothHaveDifferentUrls =
        item.dedupe.urlKey && firstFallback.hasUrl;

      if (!bothHaveDifferentUrls) {
        continue;
      }
    }

    kept.push(item);

    if (item.dedupe.urlKey) {
      seenUrlKeys.add(item.dedupe.urlKey);
    }

    if (!firstFallback) {
      firstFallbackByKey.set(item.dedupe.fallbackKey, {
        hasUrl: Boolean(item.dedupe.urlKey),
      });
    }
  }

  return kept;
}
