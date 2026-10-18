import assert from "node:assert/strict";
import test from "node:test";
import {
  isRecommendationTrackingEligible,
  selectRecommendations,
} from "../src/lib/jobs/recommendation-eligibility";
import { isApplyTodayJob } from "../src/lib/jobs/prioritization";
import { candidate, newJobs, renderToday, repeated, runDate, todayItem } from "./today-fixtures";

test("excludes applications, in-progress and closed statuses even with strong recommendations", () => {
  const excludedStatuses = [
    "APPLYING", "APPLIED", "INTERVIEWING", "OFFER", "REJECTED", "PASSED", "ARCHIVED",
  ];
  const jobs = excludedStatuses.map((status) => candidate(status, { status, fitScore: 100 }));
  jobs.push(candidate("applied-date", { status: "INTERESTED", appliedAt: "2026-10-01" }));

  for (const job of jobs) {
    assert.equal(isRecommendationTrackingEligible(job.status, job.appliedAt), false);
  }
  assert.equal(isRecommendationTrackingEligible("NEW", null), true);
  assert.equal(isRecommendationTrackingEligible("INTERESTED", null), true);
  assert.deepEqual(selectRecommendations(jobs, runDate), { eligible: [], suppressed: jobs });
});

test("preserves original typed objects and prioritizes first-time recommendations", () => {
  const fresh = newJobs(3).map((job) => ({ ...job, title: `Title ${job.jobId}` }));
  const repeat = { ...repeated("repeat"), title: "A repeated role" };
  const input = [repeat, ...fresh];
  const result = selectRecommendations(input, runDate);

  assert.deepEqual(result.eligible.map((job) => job.jobId), ["new-0", "new-1", "new-2", "repeat"]);
  assert.equal(result.eligible[3], repeat);
  assert.equal(result.eligible[3].title, "A repeated role");
  assert.deepEqual(input, [repeat, ...fresh]);
});

test("requires every repeat signal rather than treating a high score as enough", () => {
  const invalidRepeats = [
    repeated("score", { fitScore: 89 }),
    repeated("score-null", { fitScore: null }),
    repeated("priority", { priority: "MEDIUM" }),
    repeated("urgent", { priority: "URGENT" }),
    repeated("reason", { repeatReason: "  " }),
    repeated("evidence", { repeatEvidenceUrl: null }),
    repeated("http", { repeatEvidenceUrl: "http://example.com/jobs/1" }),
    repeated("invalid", { repeatEvidenceUrl: "not a url" }),
    repeated("unsafe", { repeatEvidenceUrl: "javascript:alert(1)" }),
  ];
  const result = selectRecommendations([...newJobs(2), ...invalidRepeats], runDate);

  assert.equal(result.eligible.length, 2);
  assert.deepEqual(result.suppressed, invalidRepeats);
});

test("ranks repeats by fit then favors the longest time since their latest earlier recommendation", () => {
  const older = repeated("older", { previousRunDates: [new Date("2026-10-07T23:59:59Z")] });
  const recent = repeated("recent", { previousRunDates: ["2026-09-01", "2026-10-13"] });
  const stronger = repeated("stronger", { fitScore: 95, previousRunDates: ["2026-10-13"] });
  const result = selectRecommendations([recent, older, stronger], runDate);

  assert.deepEqual(result.eligible, [stronger, older, recent]);
  assert.deepEqual(result.suppressed, []);
});

test("same-day and later records do not make a first recommendation a repeat", () => {
  const sameDay = candidate("same-day", { previousRunDates: ["2026-10-14T23:00:00Z", "2026-10-15"] });
  const result = selectRecommendations([sameDay], runDate);
  assert.deepEqual(result, { eligible: [sameDay], suppressed: [] });
});

test("fills a shortage to ten with strong evidenced repeats without a repeat quota or cooldown", () => {
  const repeats = Array.from({ length: 10 }, (_, index) => repeated(`repeat-${index}`, {
    fitScore: 90,
    previousRunDates: ["2026-10-13"],
    repeatReason: "Verified current opening: the role, level, and Python/Postgres stack closely match the resume.",
  }));
  const fresh = newJobs(2);
  const result = selectRecommendations([...repeats, ...fresh], runDate);
  assert.equal(result.eligible.length, 10);
  assert.deepEqual(result.eligible, [...fresh, ...repeats.slice(0, 8)]);
  assert.deepEqual(result.suppressed, repeats.slice(8));

  assert.equal(selectRecommendations(repeats, runDate).eligible.length, 10);
});

test("ranks fresh roles by fit and fills all ten slots with fresh roles before considering repeats", () => {
  const fresh = newJobs(12).map((job, index) => ({ ...job, fitScore: 70 + index }));
  const repeat = repeated("perfect-repeat", { fitScore: 100 });
  const result = selectRecommendations([repeat, ...fresh], runDate);
  assert.deepEqual(result.eligible.map((job) => job.jobId), [...fresh].reverse().slice(0, 10).map((job) => job.jobId));
  assert.ok(result.suppressed.includes(repeat));
  assert.equal(result.eligible.length, 10);
});

test("a shortage never permits applied jobs back into the recommendations", () => {
  const applied = newJobs(10).map((job) => ({ ...job, status: "APPLIED" }));
  const repeat = repeated("repeat");
  const result = selectRecommendations([...newJobs(2), ...applied, repeat], runDate);
  assert.equal(result.eligible.length, 3);
  assert.ok(result.eligible.includes(repeat));
  assert.deepEqual(result.suppressed, applied);
});

test("apply-today badges never bypass tracking or a saved application date", () => {
  for (const status of ["APPLYING", "APPLIED", "INTERVIEWING", "OFFER", "REJECTED", "PASSED", "ARCHIVED"]) {
    assert.equal(isApplyTodayJob({ status, fitScore: 100, concerns: null, suggestedAction: "Apply today", highFitThreshold: 80 }), false);
  }
  assert.equal(isApplyTodayJob({ status: "NEW", appliedAt: new Date(), fitScore: 100, concerns: null, suggestedAction: "Apply today", highFitThreshold: 80 }), false);
});

test("Today excludes applied rows by default and explains how to find existing applications", () => {
  const job = todayItem(candidate("already-applied", { status: "APPLIED", appliedAt: "2026-10-10" }));
  const markup = renderToday([job]);
  assert.ok(!markup.includes(job.title));
  assert.match(markup, /No new recommendations qualify/u);
  assert.match(markup, /Show hidden \(1\)/u);
  assert.match(markup, /href="\/board"/u);

  const review = renderToday([job], true);
  assert.ok(review.includes(job.title));
  assert.ok(review.includes("Hidden · history review"));
  assert.ok(!review.includes("badge-apply"));
  assert.ok(review.includes("View source"));
});

test("Today labels a qualified repeat and displays its reason after new jobs", () => {
  const repeat = todayItem(repeated("repeat"));
  const markup = renderToday([repeat, ...newJobs(3).map(todayItem)]);
  assert.ok(markup.indexOf("Role new-2") < markup.indexOf("Role repeat"));
  assert.match(markup, />Repeat</u);
  assert.ok(markup.includes(repeat.repeatReason!));
  // Evidence gates eligibility only; the Apply link already opens the posting.
  assert.ok(!markup.includes(repeat.repeatEvidenceUrl!));
  assert.ok(!markup.includes("View supporting evidence"));
});

test("Today cards omit suggested action, untracked status, and repeated remote type", () => {
  const fresh = { ...todayItem(candidate("fresh")), location: "United States; remote", remoteType: "remote" };
  const interested = { ...todayItem(candidate("interested", { status: "INTERESTED" })), remoteType: "hybrid" };
  const markup = renderToday([fresh, interested]);
  assert.ok(markup.includes("Role fresh"));
  assert.ok(!markup.includes("Suggested Action"));
  assert.ok(!markup.includes(">New<"));
  assert.equal(markup.match(/status-dot/gu)?.length, 1);
  assert.ok(!markup.includes(" · remote<"));
  assert.ok(markup.includes(" · hybrid<"));
});

test("Today omits the Show hidden toggle when nothing is hidden", () => {
  const markup = renderToday(newJobs(3).map(todayItem));
  assert.ok(markup.includes("Role new-0"));
  assert.ok(!markup.includes("Show hidden"));
});

test("Today keeps qualifying repeats visible after tracking changes and respects blocked posting aliases", () => {
  const fresh = newJobs(3).map(todayItem);
  fresh[0].status = "APPLIED";
  const alias = { ...todayItem(candidate("alias")), blockedByRelatedTracking: true };
  const markup = renderToday([...fresh, todayItem(repeated("repeat")), alias]);
  assert.ok(markup.includes("Role new-1"));
  assert.ok(markup.includes("Role new-2"));
  assert.ok(!markup.includes("Role new-0"));
  assert.ok(markup.includes("Role repeat"));
  assert.ok(!markup.includes("Role alias"));
  assert.match(markup, /Show hidden \(2\)/u);
});

test("older dates show original rows without history labels or current application prompts", () => {
  const applied = todayItem(candidate("historical-applied", { status: "APPLIED", appliedAt: "2026-10-10" }));
  const repeat = todayItem(repeated("historical-repeat", { fitScore: 70, repeatReason: null, repeatEvidenceUrl: null }));
  const archived = todayItem(candidate("historical-archived", { status: "ARCHIVED" }));
  const jobs = [...newJobs(9).map(todayItem), applied, repeat, archived];
  const markup = renderToday(jobs, false, true);

  for (const job of jobs) assert.ok(markup.includes(job.title), job.title);
  assert.ok(!markup.includes("Historical review"));
  assert.ok(!markup.includes(">History<"));
  assert.ok(!markup.includes("badge-apply"));
  assert.ok(!markup.includes("Apply Today"));
  assert.ok(!markup.includes("Hidden · history review"));
  assert.ok(!markup.includes("Show hidden"));
  assert.ok(markup.includes("View source"));
  assert.ok(!markup.includes("These are past recommendations"));
});
