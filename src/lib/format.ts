export function formatDateOnly(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function formatSalary(min: number | null, max: number | null) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  if (min && max) {
    return `${formatter.format(min)} - ${formatter.format(max)}`;
  }

  if (min) {
    return `${formatter.format(min)}+`;
  }

  if (max) {
    return `Up to ${formatter.format(max)}`;
  }

  return null;
}

export function formatStatusLabel(status: string) {
  return status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

const REVIEW_TIME_ZONE = "America/Los_Angeles";

export function getLocalDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REVIEW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

// Noon UTC falls on the same calendar day in REVIEW_TIME_ZONE, so date-only
// values round-trip through formatDateInput unchanged.
export function parseDateInput(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }

  return new Date(`${value}T12:00:00.000Z`);
}

// Uses the review time zone, not UTC: applications are often recorded in the
// Pacific evening, after the UTC date has already rolled over.
export function formatDateInput(value: Date | null | undefined) {
  return value ? getLocalDateKey(value) : "";
}
