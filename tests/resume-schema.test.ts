import assert from "node:assert/strict";
import test from "node:test";
import { ResumeTailoringError } from "../src/lib/resume/errors";
import { parseGeminiResumeResponse } from "../src/lib/resume/schema";

function assertResumeError(error: unknown, code: ResumeTailoringError["code"]) {
  assert.ok(error instanceof ResumeTailoringError);
  assert.equal(error.code, code);
}

test("parses valid Gemini resume JSON", () => {
  const parsed = parseGeminiResumeResponse(
    JSON.stringify({
      ok: true,
      markdown: "# Isaac Zhu\n\nTailored resume content.",
      warnings: ["Review dbt evidence."],
      changes: ["Moved Spark work higher."],
    }),
  );

  assert.equal(parsed.markdown.includes("Tailored resume"), true);
  assert.deepEqual(parsed.warnings, ["Review dbt evidence."]);
  assert.deepEqual(parsed.changes, ["Moved Spark work higher."]);
});

test("normalizes missing or null warnings and changes to empty arrays", () => {
  assert.deepEqual(
    parseGeminiResumeResponse(
      JSON.stringify({ ok: true, markdown: "# Isaac Zhu\n\nContent" }),
    ),
    {
      ok: true,
      markdown: "# Isaac Zhu\n\nContent",
      warnings: [],
      changes: [],
    },
  );

  assert.deepEqual(
    parseGeminiResumeResponse(
      JSON.stringify({
        ok: true,
        markdown: "# Isaac Zhu\n\nContent",
        warnings: null,
        changes: null,
      }),
    ),
    {
      ok: true,
      markdown: "# Isaac Zhu\n\nContent",
      warnings: [],
      changes: [],
    },
  );
});

test("extracts an outermost JSON object from harmless wrapper text", () => {
  const parsed = parseGeminiResumeResponse(
    'Here is the JSON: {"ok":true,"markdown":"# Isaac Zhu\\n\\nContent","warnings":[],"changes":[]} thanks',
  );

  assert.equal(parsed.markdown, "# Isaac Zhu\n\nContent");
});

test("rejects empty markdown and missing ok true", () => {
  assert.throws(
    () => parseGeminiResumeResponse('{"ok":true,"markdown":""}'),
    (error) => {
      assertResumeError(error, "GEMINI_INVALID_JSON");
      return true;
    },
  );

  assert.throws(
    () => parseGeminiResumeResponse('{"markdown":"# Isaac"}'),
    (error) => {
      assertResumeError(error, "GEMINI_INVALID_JSON");
      return true;
    },
  );
});

test("rejects malformed JSON instead of accepting partial markdown fallback", () => {
  assert.throws(
    () => parseGeminiResumeResponse("# Isaac Zhu\n\nNot JSON"),
    (error) => {
      assertResumeError(error, "GEMINI_INVALID_JSON");
      return true;
    },
  );
});
