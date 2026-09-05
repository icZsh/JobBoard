import assert from "node:assert/strict";
import test from "node:test";
import { ResumeTailoringError } from "../src/lib/resume/errors";
import {
  assertTextResumePath,
  assertUsableResumeText,
  capPromptText,
  hasLikelyBinaryContent,
  stripHtmlForPrompt,
} from "../src/lib/resume/input";

function assertResumeError(error: unknown, code: ResumeTailoringError["code"]) {
  assert.ok(error instanceof ResumeTailoringError);
  assert.equal(error.code, code);
}

test("accepts Markdown and plain-text resume paths", () => {
  assert.equal(assertTextResumePath("/tmp/resume.md"), undefined);
  assert.equal(assertTextResumePath("/tmp/resume.markdown"), undefined);
  assert.equal(assertTextResumePath("/tmp/resume.txt"), undefined);
});

test("rejects PDF, Office, image, and extensionless resume paths", () => {
  for (const filePath of [
    "/tmp/resume.pdf",
    "/tmp/resume.docx",
    "/tmp/resume.doc",
    "/tmp/resume.png",
    "/tmp/resume",
  ]) {
    assert.throws(
      () => assertTextResumePath(filePath),
      (error) => {
        assertResumeError(error, "RESUME_NOT_TEXT");
        return true;
      },
    );
  }
});

test("detects likely binary resume content", () => {
  assert.equal(hasLikelyBinaryContent("# Isaac Zhu\n\nExperience"), false);
  assert.equal(hasLikelyBinaryContent("abc\u0000def"), true);
  assert.equal(hasLikelyBinaryContent("\ufffd".repeat(10) + "abc"), true);

  assert.throws(
    () => assertUsableResumeText("abc\u0000def"),
    (error) => {
      assertResumeError(error, "RESUME_NOT_TEXT");
      return true;
    },
  );
});

test("strips HTML and script/style content from job descriptions", () => {
  const stripped = stripHtmlForPrompt(
    '<section><h1>Data Engineer</h1><script>ignore()</script><style>.x{}</style><p>Build <strong>Spark</strong> jobs &amp; dashboards.</p></section>',
  );

  assert.equal(stripped.includes("ignore"), false);
  assert.equal(stripped.includes(".x"), false);
  assert.equal(stripped.includes("<strong>"), false);
  assert.equal(stripped.includes("Data Engineer"), true);
  assert.equal(stripped.includes("Spark jobs & dashboards"), true);
});

test("caps prompt text with a clear truncation marker", () => {
  assert.equal(capPromptText("abcdef", 10), "abcdef");
  assert.equal(capPromptText("abcdef", 4), "abcd\n\n[truncated]");
});
