import assert from "node:assert/strict";
import test from "node:test";
import { matchesTodayFilter } from "../src/app/today/today-client";
import { candidate, newJobs, renderToday, todayItem } from "./today-fixtures";

function filterLabels(markup: string) {
  const group = markup.match(/<div class="paper-seg"[^>]*>(.*?)<\/div>/u)?.[1] ?? "";
  return Array.from(group.matchAll(/<button[^>]*>([^<]*)<\/button>/gu), (match) => match[1]);
}

test("Today filters are All, Apply Today and Interested, dropping Apply Today for older dates", () => {
  const jobs = newJobs(3).map(todayItem);
  const markup = renderToday(jobs);

  assert.deepEqual(filterLabels(markup), ["All", "Apply Today", "Interested"]);
  assert.deepEqual(filterLabels(renderToday(jobs, false, true)), ["All", "Interested"]);
  assert.doesNotMatch(markup, />High Fit<\/button>/u);
  assert.doesNotMatch(markup, />Tracking<\/button>/u);
});

test("Today sorts with one labeled compact select instead of a Sort label and segments", () => {
  const markup = renderToday(newJobs(3).map(todayItem));
  const select = markup.match(/<select aria-label="Sort by"[^>]*>(.*?)<\/select>/u)?.[1] ?? "";
  const options = Array.from(
    select.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/gu),
    ([, value, label]) => [value, label],
  );

  assert.match(markup, /<label class="paper-compact-select[^"]*"><span class="sr-only">Sort by<\/span><select aria-label="Sort by"/u);
  assert.deepEqual(options, [
    ["fit", "Sort: Fit score"],
    ["salary", "Sort: Salary"],
    ["company", "Sort: Company"],
  ]);
  assert.match(select, /<option value="fit" selected="">/u);
  assert.doesNotMatch(markup, />\s*Sort\s*</iu);
});

test("the Interested filter keeps only Interested jobs, not applied or closed ones", () => {
  const jobs = ["NEW", "INTERESTED", "APPLYING", "APPLIED", "PASSED", "ARCHIVED"].map((status) =>
    todayItem(candidate(status, { status })),
  );
  const matching = (filter: "all" | "apply" | "interested", historicalReview = false) =>
    jobs.filter((job) => matchesTodayFilter(job, filter, 80, historicalReview)).map((job) => job.status);

  assert.deepEqual(matching("interested"), ["INTERESTED"]);
  assert.deepEqual(matching("interested", true), ["INTERESTED"]);
  assert.deepEqual(matching("apply"), ["NEW", "INTERESTED"]);
  assert.deepEqual(matching("apply", true), []);
  assert.equal(matching("all").length, jobs.length);
});
