import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/prisma";
import { collect } from "../src/lib/collector/runner";
import type {
  CollectorPosting,
  CollectorSource,
} from "../src/lib/collector/types";
import { importJobsPayload } from "../src/lib/import/import-service";
import { defaultSelfHostConfig } from "../src/lib/selfhost/config";
import {
  compactCollectionReport,
  queueCollectionRun,
} from "../src/lib/selfhost/runs";
import {
  executeCollectionRun,
  pruneRunSnapshots,
} from "../src/lib/selfhost/worker";

const COMPANY = "Selfhost Worker Integration Fixture";
const PREFIX = "selfhost-worker-fixture";
const now = new Date("2026-09-05T16:00:00Z");
const ids = new Set<string>();
const source: CollectorSource = {
  provider: "ashby",
  board: "selfhost-test",
  company: COMPANY,
  websiteUrl: null,
  enabled: true,
};
const other: CollectorSource = {
  ...source,
  provider: "lever",
  board: "selfhost-other",
};
let originalLedger: { key: string; value: string } | null = null;

function config() {
  const config = defaultSelfHostConfig();
  config.schedule.enabled = false;
  config.collector.sources = [source, other];
  return config;
}

function posting(s: CollectorSource = source): CollectorPosting {
  return {
    provider: s.provider,
    board: s.board,
    externalId: "1",
    title: "Data Engineer",
    company: COMPANY,
    companyWebsiteUrl: null,
    locations: ["New York, NY"],
    country: "US",
    remoteType: "hybrid",
    employmentType: "FullTime",
    description:
      "Requirements\n3 years of experience with Python SQL Spark Airflow Kafka pipelines.",
    sourceUrl: `https://example.com/${PREFIX}/${s.board}/1`,
    salaryMin: 170000,
    salaryMax: 190000,
    datePosted: "2026-09-01",
    dateEvidence: "first_published",
    sourceUpdatedAt: null,
    warnings: [],
  };
}

function payload() {
  return {
    run_date: "2026-09-05",
    source_name: PREFIX,
    jobs: [
      {
        title: "Data Engineer",
        company: COMPANY,
        source_url: `https://example.com/${PREFIX}/baseline`,
      },
    ],
  };
}

async function newRun() {
  const row = await prisma.collectionRun.create({
    data: {
      trigger: "manual",
      runKey: `${PREFIX}:${randomUUID()}`,
      configSnapshot: config() as unknown as Prisma.InputJsonValue,
    },
  });
  ids.add(row.id);
  return row;
}

async function cleanup() {
  await prisma.collectionRun.deleteMany({ where: { id: { in: [...ids] } } });
  await prisma.job.deleteMany({ where: { company: COMPANY } });
  await prisma.importRun.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: PREFIX } },
        { idempotencyKey: { in: [...ids].map((id) => `collection:${id}`) } },
        { sourceName: PREFIX },
      ],
    },
  });
  await prisma.setting.deleteMany({ where: { key: "collector_observations" } });
  ids.clear();
}

before(async () => {
  originalLedger = await prisma.setting.findUnique({
    where: { key: "collector_observations" },
  });
});
beforeEach(cleanup);
after(async () => {
  await cleanup();
  if (originalLedger)
    await prisma.setting.upsert({
      where: { key: originalLedger.key },
      create: { key: originalLedger.key, value: originalLedger.value },
      update: { value: originalLedger.value },
    });
  await prisma.$disconnect();
});

test("keyed imports serialize concurrent requests and replay exact stats without duplicate recommendations", async () => {
  const key = `${PREFIX}:${randomUUID()}`;
  const body = payload();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      importJobsPayload(body, prisma, { idempotencyKey: key }),
    ),
  );
  assert.ok(results.every((result) => result.ok));
  results.forEach((result) => assert.deepEqual(result, results[0]));
  assert.equal(
    await prisma.importRun.count({ where: { idempotencyKey: key } }),
    1,
  );
  assert.equal(
    await prisma.jobRecommendation.count({
      where: { job: { company: COMPANY } },
    }),
    1,
  );
  const conflict = await importJobsPayload(
    { ...body, jobs: [{ ...body.jobs[0], title: "Different role" }] },
    prisma,
    { idempotencyKey: key },
  );
  assert.equal(conflict.ok, false);
  assert.match(!conflict.ok ? conflict.errorMessage : "", /different payload/i);
  assert.equal(
    await prisma.jobRecommendation.count({
      where: { job: { company: COMPANY } },
    }),
    1,
  );
});

test("lease loss before commit rolls back keyed import and allows a safe exact retry", async () => {
  const key = `${PREFIX}:${randomUUID()}`;
  let checks = 0;
  const failed = await importJobsPayload(payload(), prisma, {
    idempotencyKey: key,
    assertLease: async () => {
      if (++checks === 2) throw new Error("lease lost");
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(
    await prisma.importRun.count({ where: { idempotencyKey: key } }),
    0,
  );
  assert.equal(await prisma.job.count({ where: { company: COMPANY } }), 0);
  const retried = await importJobsPayload(payload(), prisma, {
    idempotencyKey: key,
  });
  assert.equal(retried.ok, true);
});

test("corrupt saved success statistics cannot authorize a second import", async () => {
  const key = `${PREFIX}:${randomUUID()}`;
  const first = await importJobsPayload(payload(), prisma, {
    idempotencyKey: key,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await prisma.importRun.update({
    where: { id: first.importRunId },
    data: {
      result: { ok: true, status: "SUCCESS", importRunId: first.importRunId },
    },
  });
  const repeated = await importJobsPayload(payload(), prisma, {
    idempotencyKey: key,
  });
  assert.equal(repeated.ok, false);
  assert.equal(
    await prisma.jobRecommendation.count({
      where: { importRunId: first.importRunId },
    }),
    1,
  );
});

test("concurrent manual triggers share one durable queued run", async () => {
  const runs = await Promise.all(
    Array.from({ length: 5 }, () => queueCollectionRun("manual", config())),
  );
  runs.forEach((run) => ids.add(run.id));
  assert.equal(new Set(runs.map((run) => run.id)).size, 1);
  assert.equal(runs[0].status, "QUEUED");
});

test("scheduled identities remain deduplicated after a run is terminal", async () => {
  const scheduledConfig = config();
  scheduledConfig.schedule.enabled = true;
  const first = await queueCollectionRun("scheduled", scheduledConfig, now);
  ids.add(first.id);
  await prisma.collectionRun.update({
    where: { id: first.id },
    data: { status: "EMPTY", finishedAt: now },
  });
  const repeated = await queueCollectionRun("scheduled", scheduledConfig, now);
  assert.equal(first.id, repeated.id);
});

test("run polling summaries omit full exclusions and bound source error text", () => {
  const report = {
    version: 1,
    runDate: "2026-09-05",
    fetchedAt: now.toISOString(),
    complete: false,
    observedCount: 3000,
    eligibleCount: 12,
    selectedCount: 12,
    duplicateRows: 0,
    scoring: "rules-v1",
    missingFromFeed: ["old-1"],
    sources: [
      {
        key: "ashby:test",
        company: COMPANY,
        status: "failed",
        postings: 0,
        error: "x".repeat(10000),
      },
    ],
    excluded: Array.from({ length: 3000 }, () => ({
      title: "Excluded posting",
      reasons: ["Mismatch"],
    })),
  };
  const summary = compactCollectionReport(report) as Prisma.JsonObject;
  assert.equal(summary.excluded, undefined);
  assert.equal(summary.missingFromFeed, undefined);
  assert.equal(summary.missingFromFeedCount, 1);
  assert.equal(summary.observedCount, 3000);
  assert.ok(JSON.stringify(summary).length < 3000);
  assert.equal(report.excluded.length, 3000);
});

test("successful source evidence publishes as PARTIAL and saves observation ledger plus raw snapshot", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "selfhost-worker-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const run = await newRun();
  const result = await executeCollectionRun(run.id, {
    dataDir,
    now: () => now,
    collectFn: (options) =>
      collect({
        ...options,
        fetchSource: async (s) => {
          if (s.provider === "lever") throw new Error("source down");
          return [posting(s)];
        },
      }),
  });
  assert.equal(result.status, "PARTIAL");
  assert.ok(result.importRunId);
  assert.equal((result.report as { complete: boolean }).complete, false);
  assert.equal(
    await prisma.jobRecommendation.count({
      where: { importRunId: result.importRunId! },
    }),
    1,
  );
  const ledger = await prisma.setting.findUniqueOrThrow({
    where: { key: "collector_observations" },
  });
  assert.equal(Object.keys(JSON.parse(ledger.value).postings).length, 1);
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(dataDir, "collector", "runs", run.id, "snapshot.json"),
        "utf8",
      ),
    ).length,
    1,
  );
});

test("crash after import success replays persisted payload without collecting or importing twice", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "selfhost-replay-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const run = await newRun();
  let lost = false;
  await assert.rejects(
    executeCollectionRun(run.id, {
      dataDir,
      now: () => now,
      assertLease: async () => {
        if (lost) throw new Error("lease lost");
      },
      collectFn: (options) =>
        collect({ ...options, fetchSource: async (s) => [posting(s)] }),
      importFn: async (...args) => {
        const result = await importJobsPayload(...args);
        assert.equal(result.ok, true);
        lost = true;
        return result;
      },
    }),
    /lease lost/,
  );
  const interrupted = await prisma.collectionRun.findUniqueOrThrow({
    where: { id: run.id },
  });
  assert.equal(interrupted.status, "PUBLISHING");
  assert.ok(interrupted.payload);
  const recovered = await executeCollectionRun(run.id, {
    dataDir,
    now: () => now,
    collectFn: async () => assert.fail("persisted payload must be replayed"),
  });
  assert.equal(recovered.status, "SUCCESS");
  assert.equal(recovered.attempts, 2);
  assert.equal(
    await prisma.importRun.count({
      where: { idempotencyKey: `collection:${run.id}` },
    }),
    1,
  );
  assert.equal(
    await prisma.jobRecommendation.count({
      where: { importRunId: recovered.importRunId! },
    }),
    2,
  );
});

test("a superseded worker cannot overwrite its successor's claim or observation ledger", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "selfhost-fencing-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const run = await newRun();
  await assert.rejects(
    executeCollectionRun(run.id, {
      dataDir,
      now: () => now,
      collectFn: async (options) => {
        const result = await collect({
          ...options,
          fetchSource: async (s) => [posting(s)],
        });
        await prisma.collectionRun.update({
          where: { id: run.id },
          data: {
            attempts: 2,
            status: "RUNNING",
            error: "successor owns this run",
          },
        });
        return result;
      },
      importFn: async () => assert.fail("superseded worker must not import"),
    }),
    /ownership changed/i,
  );
  const successor = await prisma.collectionRun.findUniqueOrThrow({
    where: { id: run.id },
  });
  assert.equal(successor.status, "RUNNING");
  assert.equal(successor.error, "successor owns this run");
  assert.equal(
    await prisma.setting.findUnique({
      where: { key: "collector_observations" },
    }),
    null,
  );
});

test("all-source failure and zero matches preserve existing imports and board data", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "selfhost-noimport-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const baseline = await importJobsPayload(payload(), prisma, {
    idempotencyKey: `${PREFIX}:${randomUUID()}`,
  });
  assert.equal(baseline.ok, true);
  for (const outcome of ["FAILED", "EMPTY"]) {
    const run = await newRun();
    const result = await executeCollectionRun(run.id, {
      dataDir,
      now: () => now,
      collectFn: (options) =>
        collect({
          ...options,
          fetchSource: async () => {
            if (outcome === "FAILED") throw new Error("all feeds unavailable");
            return [];
          },
        }),
      importFn: async () => assert.fail("must not publish an empty result"),
    });
    assert.equal(result.status, outcome);
    assert.equal(result.importRunId, null);
  }
  assert.equal(await prisma.job.count({ where: { company: COMPANY } }), 1);
  assert.equal(
    await prisma.jobRecommendation.count({
      where: { job: { company: COMPANY } },
    }),
    1,
  );
});

test("retention removes only old terminal raw files and keeps DB recovery records", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "selfhost-retention-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const terminal = await newRun();
  const active = await newRun();
  await prisma.collectionRun.update({
    where: { id: terminal.id },
    data: {
      status: "SUCCESS",
      finishedAt: new Date("2026-07-01T00:00:00Z"),
      payload: payload(),
    },
  });
  for (const run of [terminal, active]) {
    const directory = path.join(dataDir, "collector", "runs", run.id);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "snapshot.json"), "[]");
  }
  await pruneRunSnapshots({ dataDir, now: () => now });
  await assert.rejects(
    stat(path.join(dataDir, "collector", "runs", terminal.id)),
    { code: "ENOENT" },
  );
  assert.ok(await stat(path.join(dataDir, "collector", "runs", active.id)));
  assert.ok(
    (
      await prisma.collectionRun.findUniqueOrThrow({
        where: { id: terminal.id },
      })
    ).payload,
  );
});
