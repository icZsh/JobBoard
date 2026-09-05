import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test(
  "managed resumes preserve active context, roll back failed confirmations, and persist downloadable tailored files",
  {
    skip: process.env.JOBBOARD_INTEGRATION_TESTS !== "1",
  },
  async (t) => {
    const { prisma } = await import("../src/lib/prisma");
    const {
      ACTIVE_RESUME_SETTING,
      confirmResume,
      createUploadedResume,
      getActiveResume,
      saveGeneratedResume,
    } = await import("../src/lib/resume/files");
    const { readResumeBytes } = await import("../src/lib/resume/storage");
    const { tailorResumeForJob } =
      await import("../src/lib/resume/tailor-service");
    const previousDataDir = process.env.DATA_DIR;
    const dataDir = await mkdtemp(path.join(tmpdir(), "resume-integration-"));
    process.env.DATA_DIR = dataDir;
    const previousActive = await prisma.setting.findUnique({
      where: { key: ACTIVE_RESUME_SETTING },
    });
    const ids: string[] = [];
    const cleanup = { jobId: undefined as string | undefined };
    const token = randomUUID();
    t.after(async () => {
      try {
        if (previousActive)
          await prisma.setting.upsert({
            where: { key: ACTIVE_RESUME_SETTING },
            create: { key: ACTIVE_RESUME_SETTING, value: previousActive.value },
            update: { value: previousActive.value },
          });
        else
          await prisma.setting.deleteMany({
            where: { key: ACTIVE_RESUME_SETTING },
          });
        await prisma.resumeFile.deleteMany({
          where: {
            OR: [
              { id: { in: ids } },
              ...(cleanup.jobId ? [{ jobId: cleanup.jobId }] : []),
            ],
          },
        });
        if (cleanup.jobId)
          await prisma.job.deleteMany({ where: { id: cleanup.jobId } });
      } finally {
        if (previousDataDir === undefined) delete process.env.DATA_DIR;
        else process.env.DATA_DIR = previousDataDir;
        await rm(dataDir, { recursive: true, force: true });
        await prisma.$disconnect();
      }
    });

    const fixture = (name: string) =>
      readFile(path.join(process.cwd(), "tests/fixtures/resumes", name));
    for (const extension of ["txt", "md", "docx", "pdf"]) {
      const resume = await createUploadedResume(
        `integration-${token}.${extension}`,
        await fixture(`resume.${extension}`),
      );
      ids.push(resume.id);
      assert.match(resume.extractedText ?? "", /Jordan Sample/);
      assert.equal(resume.confirmedAt, null);
      assert.equal(
        (
          await prisma.setting.findUnique({
            where: { key: ACTIVE_RESUME_SETTING },
          })
        )?.value,
        previousActive?.value,
      );
      assert.deepEqual(
        await readResumeBytes(resume.storageKey),
        await fixture(`resume.${extension}`),
      );
    }
    await confirmResume(
      ids[0],
      "# Candidate A\nConfirmed experience from candidate A.",
    );
    assert.equal((await getActiveResume())?.id, ids[0]);
    const count = await prisma.resumeFile.count();
    await assert.rejects(
      createUploadedResume("encrypted.pdf", await fixture("encrypted.pdf")),
      /Encrypted PDF/,
    );
    await assert.rejects(
      createUploadedResume("corrupt.docx", Buffer.from("not a document")),
      /corrupt/,
    );
    await assert.rejects(
      createUploadedResume("empty.txt", Buffer.alloc(0)),
      /empty/,
    );
    assert.equal(await prisma.resumeFile.count(), count);
    assert.equal((await getActiveResume())?.id, ids[0]);
    await assert.rejects(confirmResume(ids[1], " "), /empty/);
    assert.equal((await getActiveResume())?.id, ids[0]);

    const failingConfirmationDb = {
      $transaction: (
        operation: (tx: {
          resumeFile: typeof prisma.resumeFile;
          setting: { upsert: () => Promise<never> };
        }) => Promise<unknown>,
      ) =>
        prisma.$transaction((tx) =>
          operation({
            resumeFile: tx.resumeFile,
            setting: {
              upsert: async () => {
                throw new Error("simulated setting write failure");
              },
            },
          }),
        ),
    } as never;
    await assert.rejects(
      confirmResume(ids[1], "Candidate B not committed", failingConfirmationDb),
      /simulated setting write failure/,
    );
    assert.equal(
      (await prisma.resumeFile.findUnique({ where: { id: ids[1] } }))
        ?.confirmedText,
      null,
    );
    assert.equal((await getActiveResume())?.id, ids[0]);

    const createdJob = await prisma.job.create({
      data: {
        title: "Reporting Engineer",
        company: "Integration Fixture",
        description: "Build reliable reporting workflows.",
        dedupeKey: `resume-test:${token}`,
        fallbackDedupeKey: `resume-test:${token}`,
        tracking: { create: {} },
      },
    });
    const jobId = createdJob.id;
    cleanup.jobId = jobId;
    const beforeFailure = await prisma.resumeFile.count();
    const diskFiles = async () =>
      (await readdir(dataDir, { recursive: true }))
        .filter((name) => /\.(pdf|docx|md|txt)$/.test(name))
        .sort();
    const beforeDisk = await diskFiles();
    await assert.rejects(
      saveGeneratedResume({
        jobId: "nonexistent-job",
        company: "Fixture",
        title: "Engineer",
        markdown: "# Candidate A",
        now: new Date(),
      }),
    );
    assert.equal(await prisma.resumeFile.count(), beforeFailure);
    assert.deepEqual(await diskFiles(), beforeDisk);

    await confirmResume(
      ids[1],
      "# Candidate B\n\nExperience\n- Built reporting workflows using verified candidate B experience.",
    );
    let prompt = "";
    const generated = await tailorResumeForJob(jobId, {
      callGemini: async (value) => {
        prompt = value;
        return {
          ok: true,
          markdown:
            "# Candidate B\n\nExperience\n- Built reliable reporting workflows using verified candidate B experience and maintained reporting quality.",
          warnings: [],
          changes: [],
        };
      },
    });
    assert.match(prompt, /Candidate B/);
    assert.doesNotMatch(prompt, /Candidate A|Jordan Sample|Isaac Zhu/);
    assert.match(generated.resumePath, /^\/api\/resumes\/[a-z0-9]+\/download$/);
    const tracking = await prisma.jobTracking.findUnique({ where: { jobId } });
    assert.equal(tracking?.resumePath, generated.resumePath);
    const generatedFile = await prisma.resumeFile.findFirstOrThrow({
      where: { jobId, kind: "TAILORED" },
    });
    assert.match(
      (await readResumeBytes(generatedFile.storageKey)).toString(),
      /Candidate B/,
    );
    await assert.rejects(
      confirmResume(
        generatedFile.id,
        "Do not replace active with a generated file",
      ),
      /Original resume not found/,
    );
    assert.equal((await getActiveResume())?.id, ids[1]);
  },
);
