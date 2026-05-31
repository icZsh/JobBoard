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

export function parseDateInput(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }

  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateInput(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}
