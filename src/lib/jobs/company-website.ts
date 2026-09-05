export function getCompanyWebsiteUrl(rawRecommendation: unknown) {
  if (
    !rawRecommendation ||
    typeof rawRecommendation !== "object" ||
    Array.isArray(rawRecommendation)
  ) {
    return null;
  }

  const value = (
    rawRecommendation as Record<string, unknown>
  ).company_website_url;

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
