import assert from "node:assert/strict";
import test from "node:test";
import { confirmResume, getActiveResume } from "../src/lib/resume/files";
import { tailorResumeForJob } from "../src/lib/resume/tailor-service";

function database(resume: Record<string, unknown>) {
  return {
    setting: { findUnique: async () => ({ value: "original-a" }) },
    resumeFile: { findUnique: async () => resume },
  } as never;
}

test("only a confirmed original is eligible as active candidate context", async () => {
  for (const resume of [
    {
      kind: "TAILORED",
      confirmedAt: new Date(),
      confirmedText: "Other person",
    },
    { kind: "ORIGINAL", confirmedAt: null, confirmedText: "Unreviewed" },
    { kind: "ORIGINAL", confirmedAt: new Date(), confirmedText: "" },
  ]) {
    assert.equal(await getActiveResume(database(resume)), null);
  }
  assert.equal(
    (
      await getActiveResume(
        database({
          kind: "ORIGINAL",
          confirmedAt: new Date(),
          confirmedText: "Jordan Sample",
        }),
      )
    )?.confirmedText,
    "Jordan Sample",
  );
});

test("confirmation updates reviewed text and active ID within one transaction; rejects generated files", async () => {
  const writes: string[] = [];
  const tx = {
    resumeFile: {
      findUnique: async () => ({ kind: "ORIGINAL" }),
      update: async (args: { data: { confirmedText: string } }) => {
        writes.push(args.data.confirmedText);
        return { id: "original-b" };
      },
    },
    setting: {
      upsert: async (args: { update: { value: string } }) => {
        writes.push(args.update.value);
      },
    },
  };
  const db = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
      writes.push("transaction");
      return fn(tx);
    },
  } as never;
  await confirmResume("original-b", "Confirmed candidate B", db);
  assert.deepEqual(writes, [
    "transaction",
    "Confirmed candidate B",
    "original-b",
  ]);
  tx.resumeFile.findUnique = async () => ({ kind: "TAILORED" });
  writes.length = 0;
  await assert.rejects(
    confirmResume("generated", "Do not activate", db),
    /Original resume not found/,
  );
  assert.deepEqual(writes, ["transaction"]);
});

test("tailoring uses the confirmed candidate and excludes previous imported candidate assessments", async () => {
  let prompt = "";
  const result = await tailorResumeForJob("job-a", {
    getConfirmedResume: async () => ({
      confirmedText: "# Candidate B\nExperience: built reporting workflows.",
      confirmedAt: new Date(),
    }),
    getJob: async () => ({
      id: "job-a",
      company: "Company",
      title: "Engineer",
      location: null,
      remoteType: null,
      salaryMin: null,
      salaryMax: null,
      sourceUrl: null,
      description: "Build reporting workflows.",
      recommendations: [
        {
          fitScore: 99,
          matchedSkills: ["Candidate A secret skill"],
          missingSkills: [],
          matchReason: "Candidate A previous employer",
          concerns: null,
          suggestedAction: null,
          importRun: { runDate: new Date(), createdAt: new Date() },
        },
      ],
    }),
    callGemini: async (value) => {
      prompt = value;
      return {
        ok: true,
        markdown:
          "# Candidate B\n\nExperience\n- Built reliable reporting workflows and maintained the team's existing dashboards.",
        warnings: [],
        changes: [],
      };
    },
    saveGeneratedResume: async () => ({
      resumePath: "/api/resumes/generated-b/download",
      resumeVersion: "company-engineer",
    }),
  });
  assert.match(prompt, /Candidate B/);
  assert.doesNotMatch(prompt, /Candidate A|Isaac Zhu|Optimize for data/);
  assert.equal(result.resumePath, "/api/resumes/generated-b/download");
});

test("unconfirmed resume cannot trigger a model call", async () => {
  await assert.rejects(
    tailorResumeForJob("job-a", {
      getJob: async () => ({
        id: "job-a",
        company: "Company",
        title: "Engineer",
        location: null,
        remoteType: null,
        salaryMin: null,
        salaryMax: null,
        sourceUrl: null,
        description: "Build reporting.",
        recommendations: [],
      }),
      getConfirmedResume: async () => ({
        confirmedText: "Draft text",
        confirmedAt: null,
      }),
      callGemini: async () =>
        assert.fail("Must not call a model before confirmation"),
    }),
    /Upload, review, and confirm/,
  );
});
