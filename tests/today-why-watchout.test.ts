import assert from "node:assert/strict";
import test from "node:test";
import { candidate, renderToday, repeated, todayItem } from "./today-fixtures";

const matchReason = "Spark and Airflow pipelines mirror the e-commerce data work on the resume.";
const concerns = "Requires Kubernetes on-call experience and the base may land under target.";

// The why / watch out block is the card's description list.
function explanationBlocks(markup: string): string[] {
  return markup.match(/<dl\b[\s\S]*?<\/dl>/gu) ?? [];
}

function explanationBlock(markup: string) {
  const [block] = explanationBlocks(markup);
  assert.ok(block, "expected a why / watch out block");
  return block;
}

// Details opens with the Company overview; the toolbar's Company sort button comes earlier.
function detailsPanel(markup: string) {
  return markup.slice(markup.lastIndexOf(">Company<"));
}

// Counts rendered text only: a clamped line's title tooltip carries the same text by design.
function countVisible(markup: string, text: string) {
  return markup.replace(/<[^>]*>/gu, "\n").split(text).length - 1;
}

test("a new job shows why it fits and what to watch out for on the collapsed card", () => {
  const job = { ...todayItem(candidate("fresh")), matchReason, concerns };
  const blocks = explanationBlocks(renderToday([job]));

  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].includes(">Why it fits<"));
  assert.ok(blocks[0].includes(`>${matchReason}<`));
  assert.ok(blocks[0].includes(">Watch out<"));
  assert.ok(blocks[0].includes(`>${concerns}<`));
  assert.ok(blocks[0].indexOf(matchReason) < blocks[0].indexOf(concerns));
  assert.equal(blocks[0].match(/line-clamp-2/gu)?.length, 2);
  assert.ok(blocks[0].includes(`title="${matchReason}"`));
  assert.ok(blocks[0].includes(`title="${concerns}"`));
});

test("a repeat shows its repeat reason in the block and its match reason in Details", () => {
  const repeat = { ...todayItem(repeated("repeat")), matchReason, concerns };
  const markup = renderToday([repeat]);
  const block = explanationBlock(markup);

  assert.ok(block.includes(">Why look again<"));
  assert.ok(block.includes(`>${repeat.repeatReason}<`));
  assert.ok(block.includes(`>${concerns}<`));
  assert.ok(!block.includes(matchReason));
  assert.ok(!block.includes("Why it fits"));

  const details = detailsPanel(markup);
  assert.ok(details.includes(">Why it fits<"));
  assert.ok(details.includes(`>${matchReason}<`));
  assert.ok(details.includes(">Matched skills<"));
  assert.ok(details.includes(">Missing skills<"));
  assert.equal(countVisible(markup, matchReason), 1);

  const olderDate = explanationBlock(renderToday([repeat], false, true));
  assert.ok(olderDate.includes(">Repeat context<"));
  assert.ok(olderDate.includes(`>${repeat.repeatReason}<`));

  const weakRepeat = { ...todayItem(repeated("weak-repeat", { fitScore: 85 })), matchReason, concerns };
  const hidden = explanationBlock(renderToday([weakRepeat], true));
  assert.ok(hidden.includes(">Repeat context<"));
  assert.ok(hidden.includes(`>${weakRepeat.repeatReason}<`));
});

test("blank concerns produce no Watch out line", () => {
  const jobs = ["", "  \n "].map((blank, index) => ({
    ...todayItem(candidate(`blank-${index}`)),
    matchReason,
    concerns: blank,
  }));
  const markup = renderToday(jobs);

  assert.equal(explanationBlocks(markup).length, 2);
  assert.equal(markup.match(/>Why it fits</gu)?.length, 2);
  assert.ok(!markup.includes("Watch out"));
});

test("a card with neither text renders no explanation block", () => {
  const fresh = { ...todayItem(candidate("quiet")), matchReason: "   ", concerns: null };
  const repeat = { ...todayItem(repeated("quiet-repeat", { repeatReason: " " })), matchReason: null, concerns: "" };
  const markup = renderToday([fresh, repeat], true);

  assert.ok(markup.includes("Role quiet"));
  assert.ok(markup.includes("Role quiet-repeat"));
  assert.deepEqual(explanationBlocks(markup), []);
  for (const label of ["Why it fits", "Why look again", "Repeat context", "Watch out"]) {
    assert.ok(!markup.includes(label), label);
  }
});

test("concerns text is rendered exactly once per card", () => {
  const repeatConcerns = "The posting now lists a hybrid schedule two days a week.";
  const fresh = { ...todayItem(candidate("fresh")), matchReason, concerns };
  const repeat = {
    ...todayItem(repeated("repeat")),
    matchReason: "Original fit summary for the repeated role.",
    concerns: repeatConcerns,
  };
  const markup = renderToday([fresh, repeat]);

  for (const text of [concerns, repeatConcerns]) {
    assert.equal(countVisible(markup, text), 1, text);
    assert.equal(markup.split(`title="${text}"`).length - 1, 1, text);
  }
  assert.ok(!markup.includes(">Concerns<"));
});
