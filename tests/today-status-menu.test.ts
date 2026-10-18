import assert from "node:assert/strict";
import test from "node:test";
import type { TodayJobItem } from "../src/app/today/today-client";
import { candidate, renderToday, todayItem } from "./today-fixtures";

const menuStatuses = [
  { value: "INTERESTED", text: "Interested" },
  { value: "APPLYING", text: "Applying" },
  { value: "APPLIED", text: "Applied" },
  { value: "PASSED", text: "Passed" },
  { value: "ARCHIVED", text: "Archived" },
];

// One entry per rendered card, listing every <select> inside that card.
function cardSelects(markup: string) {
  return markup.split("<article").slice(1).map((card) =>
    [...card.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gu)].map(([, attributes, body]) => ({
      name: /aria-label="([^"]*)"/u.exec(attributes)?.[1] ?? null,
      options: [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gu)].map(([, optionAttributes, text]) => ({
        value: /value="([^"]*)"/u.exec(optionAttributes)?.[1] ?? null,
        text,
        selected: /\bselected=""/u.test(optionAttributes),
        disabled: /\bdisabled=""/u.test(optionAttributes),
      })),
    })),
  );
}

function statusMenu(job: TodayJobItem, showHidden = false) {
  const cards = cardSelects(renderToday([job], showHidden));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].length, 1);
  return cards[0][0];
}

test("each Today card renders one compact status select offering the five menu statuses", () => {
  const jobs = [
    todayItem(candidate("fresh")),
    todayItem(candidate("interested", { status: "INTERESTED" })),
    todayItem(candidate("rejected", { status: "REJECTED" })),
  ];
  const markup = renderToday(jobs, true);
  const cards = cardSelects(markup);

  assert.equal(cards.length, jobs.length);
  for (const selects of cards) {
    assert.equal(selects.length, 1);
    assert.deepEqual(
      selects[0].options.filter((option) => !option.disabled).map(({ value, text }) => ({ value, text })),
      menuStatuses,
    );
  }
  assert.deepEqual(
    cards.map((selects) => selects[0].name).sort(),
    jobs.map((job) => `Status for ${job.title}`).sort(),
  );
  for (const card of markup.split("<article").slice(1)) {
    assert.match(card, /<label class="paper-compact-select"><select\b/u);
    assert.match(card, /paper-compact-select-caret/u);
  }
});

test("an untracked card prompts with a selected, disabled Set status option", () => {
  const menu = statusMenu(todayItem(candidate("fresh")));

  assert.deepEqual(menu.options[0], { value: "NEW", text: "Set status", selected: true, disabled: true });
  assert.equal(menu.options.length, menuStatuses.length + 1);
  assert.equal(menu.options.filter((option) => option.selected).length, 1);
  assert.ok(!menu.options.some((option) => option.text === "New"));
});

test("menu statuses are selected in place without an extra current option", () => {
  for (const { value } of menuStatuses) {
    const menu = statusMenu(todayItem(candidate(value.toLowerCase(), { status: value })), true);

    assert.equal(menu.options.length, menuStatuses.length, value);
    assert.deepEqual(menu.options.filter((option) => option.selected).map((option) => option.value), [value]);
    assert.ok(menu.options.every((option) => !option.disabled), value);
  }

  const interested = statusMenu(todayItem(candidate("interested", { status: "INTERESTED" })));
  assert.deepEqual(interested.options.filter((option) => option.selected).map((option) => option.value), ["INTERESTED"]);
});

test("with Show hidden on, statuses outside the menu show as the disabled current option", () => {
  for (const [status, text] of [["REJECTED", "Rejected"], ["INTERVIEWING", "Interviewing"], ["OFFER", "Offer"]]) {
    const menu = statusMenu(todayItem(candidate(status.toLowerCase(), { status })), true);

    assert.deepEqual(menu.options[0], { value: status, text, selected: true, disabled: true });
    assert.equal(menu.options.length, menuStatuses.length + 1, status);
    assert.equal(menu.options.filter((option) => option.selected).length, 1, status);
  }
});

test("Today cards no longer render per-status buttons", () => {
  const jobs = [
    todayItem(candidate("fresh")),
    ...menuStatuses.map(({ value }) => todayItem(candidate(value.toLowerCase(), { status: value }))),
  ];
  const markup = renderToday(jobs, true);

  assert.equal(markup.split("<article").length - 1, jobs.length);
  // The toolbar has its own "Interested" filter button; only the cards matter here.
  const cards = markup.slice(markup.indexOf("<article"));
  for (const { text } of menuStatuses) {
    assert.doesNotMatch(cards, new RegExp(`<button[^>]*>${text}</button>`, "u"));
  }
  assert.ok(!cards.includes(">Archived</button>"));
});
