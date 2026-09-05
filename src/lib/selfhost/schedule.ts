export interface ScheduledSlot {
  key: string;
  localDate: string;
  scheduledFor: Date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const slots = new Map<string, number | null>();

function localParts(now: Date, timezone: string) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function calendarDate(now: Date, timezone: string) {
  return localParts(now, timezone).date;
}

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

/** Repeated wall times run once at the first occurrence; skipped times run at the first valid later minute. */
export function scheduledSlot(
  localDate: string,
  timezone: string,
  time: string,
): ScheduledSlot | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(localDate) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new Error("Invalid schedule date or time");
  const key = `scheduled:${timezone}:${time}:${localDate}`;
  if (!slots.has(key)) {
    const nominal = Date.parse(`${localDate}T${time}:00Z`);
    if (!Number.isFinite(nominal)) throw new Error("Invalid schedule date");
    let fallback: { time: string; instant: number } | null = null;
    let exact: number | null = null;
    // Real-world offsets and date-line changes fit within this window. Minute resolution matches HH:mm configuration.
    for (
      let instant = nominal - 18 * 3600000;
      instant <= nominal + 18 * 3600000;
      instant += 60000
    ) {
      const local = localParts(new Date(instant), timezone);
      if (local.date !== localDate) continue;
      if (local.time === time) {
        exact = instant;
        break;
      }
      if (local.time > time && (!fallback || local.time < fallback.time))
        fallback = { time: local.time, instant };
    }
    if (slots.size > 1000) slots.clear();
    slots.set(key, exact ?? fallback?.instant ?? null);
  }
  const instant = slots.get(key)!;
  return instant === null
    ? null
    : { key, localDate, scheduledFor: new Date(instant) };
}

/** At most one missed slot is returned, regardless of how long the worker was offline. */
export function getLatestScheduledSlot(
  now: Date,
  timezone: string,
  time: string,
): ScheduledSlot | null {
  const today = calendarDate(now, timezone);
  for (let days = 0; days >= -3; days--) {
    const slot = scheduledSlot(shiftDate(today, days), timezone, time);
    if (slot && slot.scheduledFor <= now) return slot;
  }
  return null;
}

export function getNextScheduledSlot(
  now: Date,
  timezone: string,
  time: string,
): ScheduledSlot | null {
  const today = calendarDate(now, timezone);
  for (let days = 0; days <= 3; days++) {
    const slot = scheduledSlot(shiftDate(today, days), timezone, time);
    if (slot && slot.scheduledFor > now) return slot;
  }
  return null;
}

/** Initial setup does not create historical runs; a successful manual refresh can satisfy the current missed slot. */
export function shouldQueueScheduledSlot(
  slot: ScheduledSlot,
  configuredAt: Date,
  manualFinishedAt?: Date | null,
) {
  return (
    slot.scheduledFor >= configuredAt &&
    (!manualFinishedAt || manualFinishedAt < slot.scheduledFor)
  );
}
