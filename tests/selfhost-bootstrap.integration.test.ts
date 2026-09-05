import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  atsUrlForSource,
  defaultSelfHostConfig,
} from "../src/lib/selfhost/config";

test(
  "first-run setup is atomic under races and cannot replace a preexisting administrator",
  {
    skip: process.env.JOBBOARD_INTEGRATION_TESTS !== "1",
  },
  async (t) => {
    const { prisma } = await import("../src/lib/prisma");
    const { bootstrapAdmin } = await import("../src/lib/auth/bootstrap");
    const [users, bootstrap, savedConfig] = await Promise.all([
      prisma.user.count(),
      prisma.bootstrap.findUnique({ where: { id: "admin" } }),
      prisma.collectionConfig.findUnique({ where: { id: "default" } }),
    ]);
    if (users || bootstrap || savedConfig) {
      t.skip(
        "Requires empty administrator/bootstrap/config tables in the explicitly enabled test database.",
      );
      await prisma.$disconnect();
      return;
    }
    const token = randomUUID();
    const company = `Bootstrap fixture ${token}`;
    const emails = [
      `first-${token}@example.test`,
      `second-${token}@example.test`,
    ];
    const base = defaultSelfHostConfig();
    const config = {
      timezone: "UTC",
      schedule: { enabled: false, time: "09:00" },
      preferences: base.preferences,
      sources: [
        {
          company,
          atsUrl: atsUrlForSource(base.collector.sources[0]),
          enabled: true,
        },
      ],
    };
    const body = (email: string) => ({
      email,
      password: "A long bootstrap test password",
      config,
    });
    let ownsBootstrap = false;
    let ownsConfig = false;
    t.after(async () => {
      try {
        // Clean only the rows created by this fixture; never reset existing users.
        await prisma.user.deleteMany({ where: { email: { in: emails } } });
        if (ownsConfig)
          await prisma.collectionConfig.deleteMany({
            where: {
              id: "default",
              value: {
                path: ["collector", "sources", "0", "company"],
                equals: company,
              },
            },
          });
        if (ownsBootstrap && (await prisma.user.count()) === 0)
          await prisma.bootstrap.deleteMany({ where: { id: "admin" } });
      } finally {
        await prisma.$disconnect();
      }
    });
    const results = await Promise.allSettled(
      emails.map((email) => bootstrapAdmin(body(email))),
    );
    ownsBootstrap = results.some((result) => result.status === "fulfilled");
    ownsConfig = ownsBootstrap;
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.bootstrap.count(), 1);
    assert.equal(await prisma.collectionConfig.count(), 1);
    await assert.rejects(() => bootstrapAdmin(body(emails[1])));
    assert.equal(await prisma.user.count(), 1);

    // Simulate an older installation with an existing user but no setup sentinel.
    await prisma.collectionConfig.delete({ where: { id: "default" } });
    ownsConfig = false;
    await prisma.bootstrap.delete({ where: { id: "admin" } });
    ownsBootstrap = false;
    await assert.rejects(
      () => bootstrapAdmin(body(emails[1])),
      /already been completed/,
    );
    assert.equal(
      await prisma.bootstrap.count(),
      0,
      "Failed bootstrap rolls back its sentinel.",
    );
    assert.equal(
      await prisma.collectionConfig.count(),
      0,
      "Failed bootstrap cannot create configuration.",
    );
    assert.equal(
      await prisma.user.count(),
      1,
      "Preexisting administrator remains intact.",
    );
  },
);
