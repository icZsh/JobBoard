import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  createTailoredResumeDestination,
  slugifyResumePart,
  writeTailoredResumeFile,
} from "../src/lib/resume/output";

const now = new Date(2026, 5, 11, 14, 30, 15);

test("slug generation lowercases, strips punctuation, and collapses dashes", () => {
  assert.equal(slugifyResumePart("  Notion, Inc. / Data Engineer!!! "), "notion-inc-data-engineer");
  assert.equal(slugifyResumePart("C++ / SQL & Spark"), "c-sql-spark");
});

test("destination includes YYYY/MM path and readable version", () => {
  const destination = createTailoredResumeDestination({
    company: "Notion Labs",
    title: "Data Engineer, Analytics Platform",
    now,
    root: "/tmp/tailored-resumes",
  });

  assert.equal(
    destination.resumeVersion,
    "notion-labs-data-engineer-analytics-platform-2026-06-11-143015",
  );
  assert.equal(
    destination.resumePath,
    path.join(
      "/tmp/tailored-resumes",
      "2026",
      "06",
      "notion-labs-data-engineer-analytics-platform-2026-06-11-143015.md",
    ),
  );
});

test("destination stays under tailored resume root", () => {
  const destination = createTailoredResumeDestination({
    company: "../../Escape Co",
    title: "../Data Engineer",
    now,
    root: "/tmp/tailored-resumes",
  });

  assert.equal(destination.resumePath.startsWith(path.resolve("/tmp/tailored-resumes") + path.sep), true);
  assert.equal(destination.resumePath.includes(".."), false);
});

test("write helper retries duplicate filenames with concrete suffixes", async () => {
  const attempted: string[] = [];

  const result = await writeTailoredResumeFile({
    company: "Notion",
    title: "Data Engineer",
    markdown: "# Isaac Zhu\n\nTailored resume",
    now,
    root: "/tmp/tailored-resumes",
    writeTextFile: async (filePath) => {
      attempted.push(filePath);
      if (attempted.length === 1) {
        const error = new Error("exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      }
    },
  });

  assert.equal(attempted.length, 2);
  assert.equal(result.resumeVersion, "notion-data-engineer-2026-06-11-143015-2");
  assert.equal(result.resumePath.endsWith("notion-data-engineer-2026-06-11-143015-2.md"), true);
});
