export function formatDateOnly(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

const millisecondsPerDay = 24 * 60 * 60 * 1000;

// Whole calendar days from a date-only posting (UTC parts) to today in timeZone.
export function formatPostedAge(
  datePosted: Date | null | undefined,
  timeZone: string,
  now = new Date(),
) {
  if (!datePosted) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const today = Date.UTC(part("year"), part("month") - 1, part("day"));
  const posted = Date.UTC(
    datePosted.getUTCFullYear(),
    datePosted.getUTCMonth(),
    datePosted.getUTCDate(),
  );
  const days = Math.round((today - posted) / millisecondsPerDay);

  if (days <= 0) {
    return "Posted today";
  }

  if (days === 1) {
    return "Posted yesterday";
  }

  return `Posted ${days} days ago`;
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

export const REVIEW_TIME_ZONE = "America/Los_Angeles";

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

// Older date inputs were stored at exact UTC midnight without an encoding tag.
// Preserve their calendar date; a genuine timestamp at that exact instant is
// indistinguishable and receives the same legacy interpretation. All other
// timestamps use Pacific dates, including evening applications after UTC rollover.
export function formatDateInput(value: Date | null | undefined) {
  if (!value) {
    return "";
  }

  if (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  ) {
    return value.toISOString().slice(0, 10);
  }

  return getLocalDateKey(value);
}
