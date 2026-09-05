import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarDate,
  getLatestScheduledSlot,
  getNextScheduledSlot,
  scheduledSlot,
  shouldQueueScheduledSlot,
} from "../src/lib/selfhost/schedule";

test("schedule uses the configured timezone and chooses only the latest missed calendar slot", () => {
  const now = new Date("2026-09-06T01:00:00Z");
  assert.equal(calendarDate(now, "America/Los_Angeles"), "2026-09-05");
  const slot = getLatestScheduledSlot(now, "America/Los_Angeles", "09:00")!;
  assert.equal(slot.localDate, "2026-09-05");
  assert.equal(slot.scheduledFor.toISOString(), "2026-09-05T16:00:00.000Z");
  assert.equal(
    getNextScheduledSlot(
      now,
      "America/Los_Angeles",
      "09:00",
    )!.scheduledFor.toISOString(),
    "2026-09-06T16:00:00.000Z",
  );
  assert.equal(
    getLatestScheduledSlot(
      new Date("2026-09-05T15:59:00Z"),
      "America/Los_Angeles",
      "09:00",
    )!.localDate,
    "2026-09-04",
  );
});

test("spring DST gap runs at the first valid later local minute", () => {
  assert.equal(
    scheduledSlot(
      "2026-03-08",
      "America/Los_Angeles",
      "02:30",
    )!.scheduledFor.toISOString(),
    "2026-03-08T10:00:00.000Z",
  );
});

test("fall DST repeated minute uses the first occurrence and one stable daily key", () => {
  const early = getLatestScheduledSlot(
    new Date("2026-11-01T08:45:00Z"),
    "America/Los_Angeles",
    "01:30",
  )!;
  const later = getLatestScheduledSlot(
    new Date("2026-11-01T09:45:00Z"),
    "America/Los_Angeles",
    "01:30",
  )!;
  assert.equal(early.scheduledFor.toISOString(), "2026-11-01T08:30:00.000Z");
  assert.equal(later.key, early.key);
});

test("non-hour offsets and skipped calendar dates do not invent schedule instants", () => {
  assert.equal(
    scheduledSlot(
      "2026-09-05",
      "Asia/Kathmandu",
      "09:00",
    )!.scheduledFor.toISOString(),
    "2026-09-05T03:15:00.000Z",
  );
  assert.equal(scheduledSlot("2011-12-30", "Pacific/Apia", "09:00"), null);
});

test("new installations do not backfill pre-install dates or immediately duplicate a successful manual refresh", () => {
  const slot = scheduledSlot("2026-09-05", "America/Los_Angeles", "09:00")!;
  assert.equal(
    shouldQueueScheduledSlot(slot, new Date("2026-09-05T16:05:00Z")),
    false,
  );
  assert.equal(
    shouldQueueScheduledSlot(slot, new Date("2026-09-01T00:00:00Z")),
    true,
  );
  assert.equal(
    shouldQueueScheduledSlot(
      slot,
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-05T16:05:00Z"),
    ),
    false,
  );
  assert.equal(
    shouldQueueScheduledSlot(
      slot,
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-05T15:59:00Z"),
    ),
    true,
  );
});
