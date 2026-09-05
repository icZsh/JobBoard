import assert from "node:assert/strict";
import test from "node:test";
import { ResumeTailoringError } from "../src/lib/resume/errors";
import { tailorResumeForJob } from "../src/lib/resume/tailor-service";

const now = new Date(2026, 5, 11, 14, 30, 15);

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    title: "Data Engineer",
    company: "Notion",
    location: "San Francisco, CA",
    remoteType: "Hybrid",
    salaryMin: 150000,
    salaryMax: 190000,
    description: "<p>Build Spark pipelines and analytics dashboards.</p>",
    sourceUrl: "https://example.com/job",
    recommendations: [
      {
        id: "rec_1",
        fitScore: 86,
        matchedSkills: ["SQL", "Spark"],
        missingSkills: ["dbt"],
        matchReason: "Strong data platform overlap.",
        concerns: "dbt evidence is light.",
        suggestedAction: "Apply today.",
        importRun: {
          runDate: new Date("2026-06-10T00:00:00.000Z"),
          createdAt: new Date("2026-06-10T08:00:00.000Z"),
        },
      },
    ],
    ...overrides,
  };
}

test("tailors a resume with injected provider/filesystem seams and updates tracking fields", async () => {
  let prompt = "";
  let readPath = "";
  let writeInput: { company: string; title: string; markdown: string } | null = null;
  let trackingUpdate: { resumePath?: string | null; resumeVersion?: string | null } | null = null;

  const result = await tailorResumeForJob("job_1", {
    now: () => now,
    getSettingsValues: async () => ({
      resumeFilePath: "/tmp/base-resume.md",
      highFitThreshold: 80,
    }),
    getJob: async () => makeJob(),
    readTextFile: async (filePath) => {
      readPath = filePath;
      return "# Isaac Zhu\n\n## Experience\n- Built Spark pipelines.";
    },
    callGemini: async (value) => {
      prompt = value;
      return {
        ok: true,
        markdown:
          "# Isaac Zhu\n\n## Experience\n- Built Spark pipelines tailored for Notion analytics platform roles.",
        warnings: ["Review dbt evidence."],
        changes: ["Moved Spark pipeline work higher."],
      };
    },
    writeTailoredResumeFile: async (input) => {
      writeInput = {
        company: input.company,
        title: input.title,
        markdown: input.markdown,
      };
      return {
        resumePath:
          "/Users/isaaczhu/Isaac's Vault/Jobs/Resumes/Tailored/2026/06/notion-data-engineer-2026-06-11-143015.md",
        resumeVersion: "notion-data-engineer-2026-06-11-143015",
      };
    },
    updateTracking: async (_jobId, input) => {
      trackingUpdate = input;
    },
  });

  assert.equal(readPath, "/tmp/base-resume.md");
  assert.equal(prompt.includes("Base resume markdown"), true);
  assert.equal(prompt.includes("Build Spark pipelines"), true);
  assert.equal(prompt.includes("dbt evidence is light"), true);
  assert.deepEqual(writeInput, {
    company: "Notion",
    title: "Data Engineer",
    markdown:
      "# Isaac Zhu\n\n## Experience\n- Built Spark pipelines tailored for Notion analytics platform roles.",
  });
  assert.deepEqual(trackingUpdate, {
    resumePath:
      "/Users/isaaczhu/Isaac's Vault/Jobs/Resumes/Tailored/2026/06/notion-data-engineer-2026-06-11-143015.md",
    resumeVersion: "notion-data-engineer-2026-06-11-143015",
  });
  assert.deepEqual(result, {
    resumePath:
      "/Users/isaaczhu/Isaac's Vault/Jobs/Resumes/Tailored/2026/06/notion-data-engineer-2026-06-11-143015.md",
    resumeVersion: "notion-data-engineer-2026-06-11-143015",
    warnings: ["Review dbt evidence."],
    changes: ["Moved Spark pipeline work higher."],
  });
});

test("throws typed error when generated markdown is suspiciously short", async () => {
  await assert.rejects(
    () =>
      tailorResumeForJob("job_1", {
        getSettingsValues: async () => ({
          resumeFilePath: "/tmp/base-resume.md",
          highFitThreshold: 80,
        }),
        getJob: async () => makeJob(),
        readTextFile: async () => "# Isaac Zhu\n\nSolid resume content.",
        callGemini: async () => ({
          ok: true,
          markdown: "# Isaac",
          warnings: [],
          changes: [],
        }),
        writeTailoredResumeFile: async () => {
          throw new Error("should not write short markdown");
        },
        updateTracking: async () => {
          throw new Error("should not update tracking");
        },
      }),
    (error) => {
      assert.ok(error instanceof ResumeTailoringError);
      assert.equal(error.code, "GEMINI_INVALID_JSON");
      return true;
    },
  );
});

test("rejects non-text resume paths before reading or calling provider", async () => {
  let readCalled = false;
  let providerCalled = false;

  await assert.rejects(
    () =>
      tailorResumeForJob("job_1", {
        getSettingsValues: async () => ({
          resumeFilePath: "/tmp/base-resume.pdf",
          highFitThreshold: 80,
        }),
        getJob: async () => makeJob(),
        readTextFile: async () => {
          readCalled = true;
          return "";
        },
        callGemini: async () => {
          providerCalled = true;
          throw new Error("should not call provider");
        },
      }),
    (error) => {
      assert.ok(error instanceof ResumeTailoringError);
      assert.equal(error.code, "RESUME_NOT_TEXT");
      return true;
    },
  );

  assert.equal(readCalled, false);
  assert.equal(providerCalled, false);
});

test("rejects jobs without description or recommendation context before provider call", async () => {
  let providerCalled = false;

  await assert.rejects(
    () =>
      tailorResumeForJob("job_1", {
        getSettingsValues: async () => ({
          resumeFilePath: "/tmp/base-resume.md",
          highFitThreshold: 80,
        }),
        getJob: async () =>
          makeJob({
            description: "",
            recommendations: [],
          }),
        readTextFile: async () => "# Isaac Zhu\n\nSolid resume content.",
        callGemini: async () => {
          providerCalled = true;
          throw new Error("should not call provider");
        },
      }),
    (error) => {
      assert.ok(error instanceof ResumeTailoringError);
      assert.equal(error.code, "NO_JOB_CONTEXT");
      return true;
    },
  );

  assert.equal(providerCalled, false);
});

test("propagates invalid provider JSON errors without writing or updating tracking", async () => {
  let wroteFile = false;
  let updatedTracking = false;

  await assert.rejects(
    () =>
      tailorResumeForJob("job_1", {
        getSettingsValues: async () => ({
          resumeFilePath: "/tmp/base-resume.md",
          highFitThreshold: 80,
        }),
        getJob: async () => makeJob(),
        readTextFile: async () => "# Isaac Zhu\n\nSolid resume content.",
        callGemini: async () => {
          throw new ResumeTailoringError(
            "GEMINI_INVALID_JSON",
            "Gemini returned invalid resume JSON.",
          );
        },
        writeTailoredResumeFile: async () => {
          wroteFile = true;
          throw new Error("should not write");
        },
        updateTracking: async () => {
          updatedTracking = true;
        },
      }),
    (error) => {
      assert.ok(error instanceof ResumeTailoringError);
      assert.equal(error.code, "GEMINI_INVALID_JSON");
      return true;
    },
  );

  assert.equal(wroteFile, false);
  assert.equal(updatedTracking, false);
});

test("cleans up written file when tracking update fails", async () => {
  let deletedPath = "";

  await assert.rejects(
    () =>
      tailorResumeForJob("job_1", {
        getSettingsValues: async () => ({
          resumeFilePath: "/tmp/base-resume.md",
          highFitThreshold: 80,
        }),
        getJob: async () => makeJob(),
        readTextFile: async () => "# Isaac Zhu\n\nSolid resume content.",
        callGemini: async () => ({
          ok: true,
          markdown:
            "# Isaac Zhu\n\n## Experience\n- Built Spark pipelines tailored for Notion analytics platform roles.",
          warnings: [],
          changes: [],
        }),
        writeTailoredResumeFile: async () => ({
          resumePath: "/tmp/tailored/notion-data-engineer.md",
          resumeVersion: "notion-data-engineer",
        }),
        updateTracking: async () => {
          throw new Error("database offline");
        },
        deleteTextFile: async (filePath) => {
          deletedPath = filePath;
        },
      }),
    (error) => {
      assert.ok(error instanceof ResumeTailoringError);
      assert.equal(error.code, "TRACKING_UPDATE_FAILED");
      return true;
    },
  );

  assert.equal(deletedPath, "/tmp/tailored/notion-data-engineer.md");
});
