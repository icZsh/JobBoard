import assert from "node:assert/strict";
import test from "node:test";
import type { Priority } from "../src/generated/prisma/client";
import { priorityBadgeClass } from "../src/lib/jobs/view";
import { candidate, renderToday, todayItem } from "./today-fixtures";

function withPriority(jobId: string, priority: Priority | null, fitScore = 90) {
  return {
    ...todayItem(candidate(jobId, { priority, fitScore })),
    priorityClass: priorityBadgeClass(priority),
  };
}

test("Today cards show no High Fit badge, even at or above the threshold", () => {
  const jobs = [withPriority("top", "HIGH", 100), withPriority("threshold", "HIGH", 80), withPriority("no-priority", null)];
  const markup = renderToday(jobs);
  for (const job of jobs) assert.ok(markup.includes(job.title), job.title);
  assert.ok(!markup.includes("badge-fit"));
});

test("Today cards show no priority badge for High or missing priority", () => {
  const high = withPriority("high", "HIGH");
  const missing = withPriority("missing", null);
  const markup = renderToday([high, missing]);
  assert.ok(markup.includes("Role high"));
  assert.ok(markup.includes("Role missing"));
  assert.ok(!markup.includes(high.priorityClass));
  assert.ok(!markup.includes(">High<"));
  assert.ok(!markup.includes(" priority<"));
});

test("Today cards label other priorities and keep their priority colouring", () => {
  const medium = withPriority("medium", "MEDIUM");
  const low = withPriority("low", "LOW");
  const urgent = withPriority("urgent", "URGENT");
  const markup = renderToday([medium, low, urgent]);
  assert.ok(markup.includes(`<span class="paper-badge ${medium.priorityClass}">Medium priority</span>`));
  assert.ok(markup.includes(`<span class="paper-badge ${low.priorityClass}">Low priority</span>`));
  assert.ok(markup.includes(`<span class="paper-badge ${urgent.priorityClass}">Urgent priority</span>`));
  // Teal is reserved for fit, so Medium must not look like the old High Fit badge.
  assert.equal(medium.priorityClass, "badge-neutral");
  assert.ok(!markup.includes("badge-fit"));
});
