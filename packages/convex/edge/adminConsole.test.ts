import polarTest from "@convex-dev/polar/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { DAY_MS, utcDay } from "../admin/stats";
import { ensureCardUsageShards } from "../card/cardUsage";
import { insertCard } from "../card/cardWrites";
import { newBackend } from "./helpers.testUtils";

const clientId = "client_ADMIN";
const adminClaims = {
  issuer: `https://api.workos.com/user_management/${clientId}`,
  subject: "user_ADMIN",
  sid: "session_ADMIN",
  email_verified: true,
  email: "owner@teak.dev",
  external_id: "teak_admin",
  client_id: clientId,
  jti: "01ADMIN",
  auth_time: 1,
};

const setup = () => {
  const t = newBackend();
  polarTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;

const seedAccount = async (
  t: Backend,
  teakUserId: string,
  workosUserId: string,
  email: string,
  role?: "admin"
) => {
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId,
      workosUserId,
      email,
      emailVerified: true,
      ...(role ? { role } : {}),
    })
  );
};

const seedAdmin = (t: Backend) =>
  seedAccount(t, "teak_admin", "user_ADMIN", "owner@teak.dev", "admin");

const seedCustomer = (t: Backend) =>
  seedAccount(t, "teak_customer", "user_CUSTOMER", "reader@teak.dev");

const asAdmin = (t: Backend) => t.withIdentity(adminClaims);
const asCustomer = (t: Backend) =>
  t.withIdentity({
    ...adminClaims,
    subject: "user_CUSTOMER",
    email: "reader@teak.dev",
    external_id: "teak_customer",
  });

const privateCard = (t: Backend) =>
  t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "teak_customer",
      type: "text",
      content: "my private journal entry",
      notes: "secret note",
      url: "https://private.example.org/diary",
      aiSummary: "a summary of the diary",
      createdAt: 1,
      updatedAt: 1,
    })
  );

const auditRows = (t: Backend) =>
  t.run((ctx) => ctx.db.query("adminAuditLog").take(50));

beforeEach(() => {
  vi.stubEnv("WORKOS_CLIENT_ID", clientId);
});
afterEach(() => vi.unstubAllEnvs());

describe("card privacy", () => {
  test("the card list never carries content, notes, URLs or AI output", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);
    await privateCard(t);

    const result = await asAdmin(t).query(api.admin.listAllCards, {
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page).toHaveLength(1);
    const listed = JSON.stringify(result.page[0]);
    for (const secret of [
      "private journal",
      "secret note",
      "private.example.org",
      "summary of the diary",
    ]) {
      expect(listed).not.toContain(secret);
    }
    expect(result.page[0]).toMatchObject({
      type: "text",
      hasUrl: true,
      hasAiSummary: true,
      isRedacted: true,
    });
  });

  test("revealing a card needs a reason and is written to the audit log", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);
    const cardId = await privateCard(t);

    await expect(
      asAdmin(t).mutation(api.admin.revealCard, { cardId, reason: " " })
    ).rejects.toThrow("A reason is required");
    expect(await auditRows(t)).toHaveLength(0);

    const revealed = await asAdmin(t).mutation(api.admin.revealCard, {
      cardId,
      reason: "Support email asking why the card failed",
    });
    expect(revealed.content).toBe("my private journal entry");
    expect(await auditRows(t)).toEqual([
      expect.objectContaining({
        action: "card.reveal",
        actorEmail: "owner@teak.dev",
        targetTeakUserId: "teak_customer",
        targetCardId: cardId,
        reason: "Support email asking why the card failed",
      }),
    ]);
  });

  test("a customer cannot reveal cards", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);
    const cardId = await privateCard(t);
    await expect(
      asCustomer(t).mutation(api.admin.revealCard, {
        cardId,
        reason: "curious",
      })
    ).rejects.toThrow("Unauthorized");
    expect(await auditRows(t)).toHaveLength(0);
  });
});

describe("account list", () => {
  test("counts each account's active cards from its card usage", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);
    await t.run(async (ctx) => {
      await ensureCardUsageShards(ctx, "teak_customer", false);
      for (const content of ["one", "two", "three"]) {
        await insertCard(ctx, {
          userId: "teak_customer",
          type: "text",
          content,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });

    const result = await asAdmin(t).query(api.admin.listAllUsers, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const counts = Object.fromEntries(
      result.page.map((user: { id: string; cardsCount: number }) => [
        user.id,
        user.cardsCount,
      ])
    );
    expect(counts).toEqual({ teak_admin: 0, teak_customer: 3 });
  });
});

describe("kill switches", () => {
  test("pausing signups from the console reaches the public auth mode", async () => {
    const t = setup();
    await seedAdmin(t);
    expect((await t.query(api.auth.getAuthMode, {})).signupsDisabled).toBe(
      false
    );

    await asAdmin(t).mutation(api.adminConsole.setKillSwitch, {
      name: "signupsPaused",
      enabled: true,
      reason: "spam wave",
    });

    expect((await t.query(api.auth.getAuthMode, {})).signupsDisabled).toBe(
      true
    );
    expect(await auditRows(t)).toEqual([
      expect.objectContaining({
        action: "kill_switch.signupsPaused",
        reason: "spam wave",
        details: { before: false, after: true },
      }),
    ]);
  });

  test("the AI gate follows the global pause and per-account switch", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);
    const gate = () =>
      t.query(internal.adminAccess.getAiGate, { userId: "teak_customer" });
    expect(await gate()).toBe("allowed");

    await asAdmin(t).mutation(api.adminConsole.setUserFlag, {
      teakUserId: "teak_customer",
      flag: "aiDisabled",
      value: true,
    });
    expect(await gate()).toBe("user_disabled");

    await asAdmin(t).mutation(api.adminConsole.setKillSwitch, {
      name: "aiPaused",
      enabled: true,
    });
    expect(await gate()).toBe("paused");
  });

  test("a customer cannot flip switches", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);
    await expect(
      asCustomer(t).mutation(api.adminConsole.setKillSwitch, {
        name: "aiPaused",
        enabled: true,
      })
    ).rejects.toThrow("Unauthorized");
    expect(await t.query(internal.adminAccess.getAiGate, { userId: "x" })).toBe(
      "allowed"
    );
  });
});

describe("internal accounts", () => {
  test("flagging an account internal is audited against that account", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);

    await asAdmin(t).mutation(api.adminConsole.setUserFlag, {
      teakUserId: "teak_customer",
      flag: "internal",
      value: true,
      reason: "my test phone",
    });

    expect(await t.query(internal.adminAccess.listInternalUserIds, {})).toEqual(
      ["teak_customer"]
    );
    const page = await asAdmin(t).query(api.adminConsole.listAuditLog, {
      paginationOpts: { cursor: null, numItems: 10 },
      targetTeakUserId: "teak_customer",
    });
    expect(page.page).toEqual([
      expect.objectContaining({
        action: "user.internal",
        reason: "my test phone",
      }),
    ]);
  });
});

describe("AI usage", () => {
  const usage = {
    userId: "teak_customer",
    calls: 2,
    errors: 1,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.25,
  };

  test("a repeated rollup sets a day's totals instead of adding to them", async () => {
    const t = setup();
    await t.mutation(internal.adminUsage.replaceDailyUsage, {
      date: "2026-10-15",
      rows: [usage],
    });
    await t.mutation(internal.adminUsage.replaceDailyUsage, {
      date: "2026-10-15",
      rows: [{ ...usage, calls: 5, costUsd: 0.75 }],
    });

    const rows = await t.run((ctx) => ctx.db.query("aiUsageDaily").take(5));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: "2026-10-15",
      calls: 5,
      errors: 1,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.75,
    });
    expect(
      await t.query(internal.adminUsage.usageForDay, { date: "2026-10-15" })
    ).toEqual([{ userId: "teak_customer", calls: 5, costUsd: 0.75 }]);
  });

  test("keeps each day and each account in its own row", async () => {
    const t = setup();
    await t.mutation(internal.adminUsage.replaceDailyUsage, {
      date: "2026-10-14",
      rows: [usage, { ...usage, userId: "teak_other", calls: 1 }],
    });
    await t.mutation(internal.adminUsage.replaceDailyUsage, {
      date: "2026-10-15",
      rows: [usage],
    });
    const { users } = await t.query(internal.adminUsage.usageByUserSince, {
      sinceDate: "2026-10-14",
    });
    const byUser = [...users].sort(
      (a: { userId: string }, b: { userId: string }) =>
        a.userId.localeCompare(b.userId)
    );
    expect(byUser).toEqual([
      { userId: "teak_customer", calls: 4, costUsd: 0.5 },
      { userId: "teak_other", calls: 1, costUsd: 0.25 },
    ]);
  });

  test("refuses a malformed date", async () => {
    const t = setup();
    await expect(
      t.mutation(internal.adminUsage.replaceDailyUsage, {
        date: "yesterday",
        rows: [usage],
      })
    ).rejects.toThrow("invalid_usage_date");
  });
});

describe("daily snapshots", () => {
  const snapshot = {
    date: "2026-10-01",
    capturedAt: 1,
    accounts: 10,
    signups: 1,
    cardsSaved: 5,
    totalCards: 50,
    activeSavers1d: 2,
    activeSavers7d: 4,
    activeSavers28d: 6,
    storageBytes: 1000,
    storageBytesAdded: 100,
    aiCostUsd: 0.1,
    aiCalls: 3,
    topStorage: [],
    isApproximate: false,
  };

  test("an admin's capture starts the Core Worker's snapshot and is audited", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);
    const dispatches = () =>
      t.run((ctx) => ctx.db.query("workflowDispatches").take(10));

    await expect(
      asCustomer(t).action(api.adminMetrics.captureSnapshot, {})
    ).rejects.toThrow("Unauthorized");
    await expect(
      asAdmin(t).action(api.adminMetrics.captureSnapshot, {
        date: "2999-01-01",
      })
    ).rejects.toThrow("Snapshot date must not be in the future");
    expect(await dispatches()).toEqual([]);

    expect(
      await asAdmin(t).action(api.adminMetrics.captureSnapshot, {
        date: "2026-10-01",
      })
    ).toEqual({ date: "2026-10-01" });

    const [row] = await dispatches();
    expect(row).toMatchObject({
      kind: "maintenance",
      state: "pending",
      params: { date: "2026-10-01", dispatched: true, task: "admin-snapshot" },
    });
    expect(row?.instanceId).toMatch(/^admin-snapshot-2026-10-01-manual-\d+$/u);
    expect(await auditRows(t)).toEqual([
      expect.objectContaining({
        action: "metrics.capture_snapshot",
        details: { date: "2026-10-01" },
      }),
    ]);
  });

  test("recapturing a past day keeps the billing seen on that day", async () => {
    const t = setup();
    const billing = {
      currency: "usd",
      mrr: 5000,
      mrrAtRisk: 0,
      netMrr: 4600,
      paying: 10,
      trialing: 0,
      pastDue: 0,
      canceling: 0,
    };
    await t.mutation(internal.adminMetrics.writeSnapshot, {
      snapshot: { ...snapshot, billing },
    });
    await t.mutation(internal.adminMetrics.writeSnapshot, {
      snapshot: { ...snapshot, cardsSaved: 7, capturedAt: 2 },
    });

    const rows = await t.run((ctx) =>
      ctx.db.query("adminDailyMetrics").take(5)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cardsSaved: 7, billing });
  });
});

describe("overview", () => {
  test("is counted live with no stored row, then read from the stored row", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);
    await privateCard(t);

    const live = await asAdmin(t).query(api.admin.getOverview, {});
    expect(live.totals).toEqual({
      totalCards: 1,
      activeCards: 1,
      deletedCards: 0,
      uniqueUsers: 1,
    });
    expect(live.isApproximate).toBe(false);

    const stored = {
      ...live,
      generatedAt: 5000,
      totals: { ...live.totals, totalCards: 1234 },
      isApproximate: true,
    };
    await t.run((ctx) =>
      ctx.db.insert("adminOverviews", { includeOnboarding: false, ...stored })
    );

    expect(await asAdmin(t).query(api.admin.getOverview, {})).toEqual(stored);
    const withOnboarding = await asAdmin(t).query(api.admin.getOverview, {
      includeOnboarding: true,
    });
    expect(withOnboarding.totals.totalCards).toBe(1);
    await expect(
      asCustomer(t).query(api.admin.getOverview, {})
    ).rejects.toThrow("Unauthorized");
  });
});

describe("daily snapshot reads", () => {
  test("the card page reads only the window it is given, leaving onboarding cards out", async () => {
    const t = setup();
    await privateCard(t);
    await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "teak_customer",
        type: "image",
        content: "",
        onboarding: "coral-lily",
        fileMetadata: { fileName: "lily.webp", fileSize: 2048 },
        createdAt: 2,
        updatedAt: 2,
      })
    );
    const later = await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "teak_reader",
        type: "image",
        content: "",
        fileMetadata: { fileName: "a.webp", fileSize: 300 },
        isDeleted: true,
        createdAt: 3,
        updatedAt: 3,
      })
    );
    const laterCreation = (await t.run((ctx) => ctx.db.get("cards", later)))
      ?._creationTime as number;

    const all = await t.query(internal.adminMetrics.cardsPage, {
      cursor: null,
    });
    const fromLater = await t.query(internal.adminMetrics.cardsPage, {
      cursor: null,
      since: laterCreation,
    });
    const beforeLater = await t.query(internal.adminMetrics.cardsPage, {
      cursor: null,
      until: laterCreation,
    });

    expect(all.rows.map((row: { userId: string }) => row.userId)).toEqual([
      "teak_customer",
      "teak_reader",
    ]);
    expect(fromLater.rows).toEqual([
      {
        userId: "teak_reader",
        createdAt: laterCreation,
        deleted: true,
        fileSize: 300,
      },
    ]);
    expect(
      beforeLater.rows.map((row: { userId: string }) => row.userId)
    ).toEqual(["teak_customer"]);
  });

  test("saver days are stored once per day, deduplicated and pruned after 35 days", async () => {
    const t = setup();
    const today = utcDay(Date.now());
    const old = utcDay(Date.now() - 40 * DAY_MS);
    await t.run((ctx) =>
      ctx.db.insert("adminDailySavers", { date: old, userIds: ["ancient"] })
    );

    await t.mutation(internal.adminMetrics.writeDaySavers, {
      date: today,
      userIds: ["a", "b", "a"],
    });
    await t.mutation(internal.adminMetrics.writeDaySavers, {
      date: today,
      userIds: ["c"],
    });

    expect(
      await t.query(internal.adminMetrics.daySavers, {
        since: old,
        until: utcDay(Date.now() + DAY_MS),
      })
    ).toEqual([{ date: today, userIds: ["c"], isTruncated: false }]);
    await t.mutation(internal.adminMetrics.writeDaySavers, {
      date: today,
      userIds: Array.from({ length: 8001 }, (_, i) => `u${i}`),
    });
    const [stored] = await t.query(internal.adminMetrics.daySavers, {
      since: today,
      until: utcDay(Date.now() + DAY_MS),
    });
    expect(stored?.userIds).toHaveLength(8000);
    expect(stored?.isTruncated).toBe(true);
  });
});

describe("cron heartbeats", () => {
  test("counts consecutive failures and clears them on success", async () => {
    const t = setup();
    const run = (phase: "started" | "succeeded" | "failed") =>
      t.mutation(internal.adminHealth.recordCronRun, {
        name: "admin-daily-snapshot",
        phase,
        ...(phase === "failed" ? { error: "Polar timed out" } : {}),
      });
    await run("started");
    await run("failed");
    await run("started");
    await run("failed");
    const failing = await t.run((ctx) =>
      ctx.db.query("cronHeartbeats").first()
    );
    expect(failing).toMatchObject({
      lastStatus: "failed",
      lastError: "Polar timed out",
      consecutiveFailures: 2,
    });

    await run("started");
    await run("succeeded");
    const healthy = await t.run((ctx) =>
      ctx.db.query("cronHeartbeats").first()
    );
    expect(healthy).toMatchObject({
      lastStatus: "succeeded",
      consecutiveFailures: 0,
    });
    expect(healthy?.lastError).toBeUndefined();
  });

  test("the dev deployment judges a task by its development cadence", async () => {
    const t = setup();
    await seedAdmin(t);
    await t.run((ctx) =>
      ctx.db.insert("cronHeartbeats", {
        name: "reconcile-workflows",
        lastStatus: "succeeded",
        lastStartedAt: Date.now() - 3 * 60 * 60 * 1000,
        lastSucceededAt: Date.now() - 3 * 60 * 60 * 1000,
        consecutiveFailures: 0,
      })
    );
    const reconcile = async () =>
      (await asAdmin(t).query(api.adminHealth.getHealth, {})).crons.find(
        (cron: { name: string }) => cron.name === "reconcile-workflows"
      );

    expect(await reconcile()).toMatchObject({
      health: "late",
      expectedEveryMs: 60 * 60 * 1000,
    });
    vi.stubEnv("TEAK_DEV_DEPLOYMENT", "true");
    expect(await reconcile()).toMatchObject({
      health: "ok",
      expectedEveryMs: 6 * 60 * 60 * 1000,
    });
  });
});

describe("admin sign-ins", () => {
  test("a sign-in is audited, and customers cannot record sign-ins", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);

    await asAdmin(t).mutation(api.adminConsole.recordSignIn, {
      ipAddress: "203.0.113.9",
      userAgent: "Safari",
    });
    await expect(
      asCustomer(t).mutation(api.adminConsole.recordSignIn, {})
    ).rejects.toThrow("Unauthorized");

    expect(await auditRows(t)).toEqual([
      expect.objectContaining({
        action: "admin.sign_in",
        details: { ipAddress: "203.0.113.9", userAgent: "Safari" },
      }),
    ]);
  });
});

describe("operations", () => {
  test("summarizes accounts and deletions", async () => {
    const t = setup();
    await seedAdmin(t);
    await seedCustomer(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        teakUserId: "teak_deleted",
        workosUserId: "user_DELETED",
        email: "gone@teak.dev",
        emailVerified: true,
        deletedAt: 1,
      });
    });
    expect(await asAdmin(t).query(api.admin.getOperations, {})).toEqual({
      accounts: { total: 3, linked: 2, unlinked: 0, deleted: 1 },
      deletions: expect.any(Object),
      isApproximate: false,
    });
    await expect(
      asCustomer(t).query(api.admin.getOperations, {})
    ).rejects.toThrow("Unauthorized");
  });
});
