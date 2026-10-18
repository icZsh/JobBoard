import assert from "node:assert/strict";
import test from "node:test";
import { formatPostedAge } from "../src/lib/format";
import { candidate, renderToday, todayItem } from "./today-fixtures";

const timeZone = "America/Los_Angeles";

// Posting dates are date-only values stored at UTC midnight.
function postedOn(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function textOf(markup: string) {
  return markup.replace(/<[^>]+>/gu, "");
}

function cardFor(markup: string, title: string) {
  return markup.split("<article").find((card) => card.includes(`>${title}<`)) ?? "";
}

test("posted age is today for the whole Los Angeles posting day", () => {
  const posted = postedOn("2026-09-30");
  assert.equal(formatPostedAge(posted, timeZone, new Date("2026-09-30T07:00:00Z")), "Posted today");
  assert.equal(formatPostedAge(posted, timeZone, new Date("2026-09-30T19:00:00Z")), "Posted today");
  assert.equal(formatPostedAge(posted, timeZone, new Date("2026-10-01T06:59:59Z")), "Posted today");
});

test("posted age is yesterday for the next Los Angeles day", () => {
  const posted = postedOn("2026-09-30");
  assert.equal(formatPostedAge(posted, timeZone, new Date("2026-10-01T07:00:00Z")), "Posted yesterday");
  assert.equal(formatPostedAge(posted, timeZone, new Date("2026-10-02T06:59:59Z")), "Posted yesterday");
});

test("posted age counts whole calendar days after that", () => {
  assert.equal(formatPostedAge(postedOn("2026-09-30"), timeZone, new Date("2026-10-02T19:00:00Z")), "Posted 2 days ago");
  // 17:36 PDT on Oct 17 is already Oct 18 in UTC.
  assert.equal(formatPostedAge(postedOn("2026-09-30"), timeZone, new Date("2026-10-18T00:36:00Z")), "Posted 17 days ago");
  // Daylight saving time ends on Nov 1, 2026.
  assert.equal(formatPostedAge(postedOn("2026-10-30"), timeZone, new Date("2026-11-02T08:30:00Z")), "Posted 3 days ago");
  assert.equal(formatPostedAge(postedOn("2025-12-02"), timeZone, new Date("2026-10-17T19:00:00Z")), "Posted 319 days ago");
});

test("posted age treats future posting dates as today", () => {
  assert.equal(formatPostedAge(postedOn("2026-10-20"), timeZone, new Date("2026-10-17T19:00:00Z")), "Posted today");
});

test("posted age is omitted when the posting date is unknown", () => {
  const now = new Date("2026-10-17T19:00:00Z");
  assert.equal(formatPostedAge(null, timeZone, now), null);
  assert.equal(formatPostedAge(undefined, timeZone, now), null);
});

test("posted age follows the Los Angeles day boundary rather than UTC", () => {
  const posted = postedOn("2026-10-16");
  // Both instants fall on Oct 17 in UTC.
  assert.equal(formatPostedAge(posted, timeZone, new Date("2026-10-17T06:30:00Z")), "Posted today");
  assert.equal(formatPostedAge(posted, timeZone, new Date("2026-10-17T07:30:00Z")), "Posted yesterday");
});

test("Today meta line shows the posting age after the salary with the absolute date on hover", () => {
  const job = {
    ...todayItem(candidate("posted")),
    salary: "$165,000 - $225,000",
    datePosted: "Sep 30, 2026",
    postedAge: "Posted 17 days ago",
  };
  const markup = renderToday([job]);

  assert.ok(textOf(markup).includes("$165,000 - $225,000 · Posted 17 days ago"));
  assert.match(markup, /<span[^>]*title="Sep 30, 2026"[^>]*>Posted 17 days ago<\/span>/u);
  assert.ok(!markup.includes("Date Posted"));
});

test("Today meta line shows the posting age alone without a salary and omits unknown dates", () => {
  const ageOnly = { ...todayItem(candidate("age-only")), datePosted: "Oct 16, 2026", postedAge: "Posted yesterday" };
  const salaryOnly = { ...todayItem(candidate("salary-only")), salary: "$150,000+" };
  const neither = todayItem(candidate("neither"));
  const markup = renderToday([ageOnly, salaryOnly, neither]);

  assert.match(cardFor(markup, ageOnly.title), /<p[^>]*><span[^>]*title="Oct 16, 2026"[^>]*>Posted yesterday<\/span><\/p>/u);
  assert.match(cardFor(markup, salaryOnly.title), /<p[^>]*>\$150,000\+<\/p>/u);
  assert.ok(!cardFor(markup, salaryOnly.title).includes("Posted"));
  assert.ok(cardFor(markup, neither.title));
  assert.ok(!cardFor(markup, neither.title).includes("Posted"));
  assert.ok(!markup.includes("Date Posted"));
});

test("Today renders the fit ring in the card header beside inline badges", () => {
  const job = { ...todayItem(candidate("ring", { fitScore: 95 })), fitTier: "Exceptional" };
  const markup = renderToday([job]);
  const header = markup.match(/<header[^>]*>[\s\S]*?<\/header>/u)?.[0] ?? "";

  assert.ok(header.includes(`>${job.title}<`));
  assert.match(header, /<div aria-label="Fit score 95, Exceptional"[^>]*role="img"[^>]*><div class="fit-ring"/u);
  assert.ok(header.includes(">Exceptional<"));
  assert.equal(markup.match(/class="fit-ring"/gu)?.length, 1);
  // Badges sit in the title row, ahead of the company line.
  assert.ok(header.indexOf("paper-badge") > -1);
  assert.ok(header.indexOf("paper-badge") < header.indexOf(">Example<"));
});

test("Today labels an unscored fit ring", () => {
  const job = { ...todayItem(candidate("unscored", { fitScore: null })), fitTier: "Not scored" };
  const markup = renderToday([job]);

  assert.match(markup, /aria-label="No fit score"/u);
  assert.match(markup, /<div class="fit-ring"[^>]*><span>-<\/span><\/div>/u);
});
