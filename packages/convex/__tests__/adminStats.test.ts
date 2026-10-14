import { describe, expect, mock, test } from "bun:test";
import {
  DAY_MS,
  summarizeAccounts,
  summarizeDailyActivity,
  summarizeDeletionQueue,
  summarizeQuarantine,
  summarizeSubscriptions,
  toActivityRow,
} from "../adminStats";
import { withTestSession } from "./helpers/session.test-utils";

const day = (date: string, hour = 12) =>
  Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00.000Z`);

describe("summarizeDailyActivity", () => {
  const since = day("2026-10-01", 0);
  const now = day("2026-10-03", 18);

  test("buckets signups, cards, uploads and finished AI stages by UTC day", () => {
    const days = summarizeDailyActivity({
      since,
      now,
      signupTimes: [day("2026-10-01"), day("2026-10-03"), day("2026-10-03")],
      cards: [
        { createdAt: day("2026-10-01"), fileMetadata: { fileSize: 2048 } },
        {
          createdAt: day("2026-10-02"),
          processingStatus: {
            classify: {
              status: "completed" as const,
              completedAt: day("2026-10-02"),
            },
            metadata: {
              status: "completed" as const,
              completedAt: day("2026-10-03"),
            },
            renderables: {
              status: "failed" as const,
              completedAt: day("2026-10-03"),
            },
          },
        },
      ].map(toActivityRow),
    });

    expect(days).toEqual([
      {
        date: "2026-10-01",
        signups: 1,
        cards: 1,
        files: 1,
        fileBytes: 2048,
        aiRuns: 0,
      },
      {
        date: "2026-10-02",
        signups: 0,
        cards: 1,
        files: 0,
        fileBytes: 0,
        aiRuns: 1,
      },
      {
        date: "2026-10-03",
        signups: 2,
        cards: 0,
        files: 0,
        fileBytes: 0,
        aiRuns: 1,
      },
    ]);
  });

  test("ignores activity outside the window", () => {
    const days = summarizeDailyActivity({
      since,
      now,
      signupTimes: [since - DAY_MS, now + DAY_MS],
      cards: [{ createdAt: since - 1, aiCompletedAt: [now + DAY_MS] }],
    });

    expect(
      days.every((entry) => entry.signups === 0 && entry.cards === 0)
    ).toBe(true);
  });
});

describe("summarizeAccounts", () => {
  test("separates linked, unlinked and deleted accounts", () => {
    expect(
      summarizeAccounts([
        { workosUserId: "user_1" },
        { workosUserId: undefined },
        { workosUserId: "user_2", deletedAt: 1 },
      ])
    ).toEqual({ total: 3, linked: 1, unlinked: 1, deleted: 1 });
  });
});

describe("summarizeQuarantine", () => {
  test("counts unresolved rows by reason", () => {
    expect(
      summarizeQuarantine([
        { reason: "email_unverified" },
        { reason: "email_unverified" },
        { reason: "link_conflict" },
      ])
    ).toEqual({
      unresolved: 3,
      byReason: { email_unverified: 2, link_conflict: 1 },
    });
  });
});

describe("summarizeDeletionQueue", () => {
  const now = day("2026-10-14");

  test("flags retries, operator cases and missed retries", () => {
    expect(
      summarizeDeletionQueue(
        [
          { startedAt: now - 2 * DAY_MS },
          {
            startedAt: now - DAY_MS,
            failureCode: "account_deletion_stage_3_failed",
            nextAttemptAt: now + 60_000,
          },
          {
            startedAt: now - 3 * DAY_MS,
            failureCode: "account_deletion_stage_4_storage_source_changed",
            nextAttemptAt: now - 2 * 60 * 60 * 1000,
          },
        ],
        now
      )
    ).toEqual({
      inProgress: 3,
      retrying: 2,
      needsAttention: 1,
      overdue: 1,
      oldestStartedAt: now - 3 * DAY_MS,
    });
  });

  test("reports an empty queue", () => {
    expect(summarizeDeletionQueue([], now)).toEqual({
      inProgress: 0,
      retrying: 0,
      needsAttention: 0,
      overdue: 0,
      oldestStartedAt: null,
    });
  });
});

describe("summarizeSubscriptions", () => {
  const monthly = { id: "p_month", name: "Pro" };
  const yearly = { id: "p_year", name: "Pro" };

  test("groups plans and normalizes yearly prices into monthly revenue", () => {
    const summary = summarizeSubscriptions([
      {
        status: "active",
        amount: 500,
        currency: "USD",
        recurringInterval: "month",
        cancelAtPeriodEnd: false,
        product: monthly,
      },
      {
        status: "active",
        amount: 500,
        currency: "usd",
        recurringInterval: "month",
        cancelAtPeriodEnd: true,
        product: monthly,
      },
      {
        status: "trialing",
        amount: 4800,
        currency: "usd",
        recurringInterval: "year",
        cancelAtPeriodEnd: false,
        product: yearly,
      },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.byStatus).toEqual({ active: 2, trialing: 1 });
    expect(summary.canceling).toBe(1);
    expect(summary.monthlyRevenue).toEqual({ usd: 1400 });
    expect(summary.plans.map((plan) => [plan.productId, plan.count])).toEqual([
      ["p_month", 2],
      ["p_year", 1],
    ]);
  });
});

describe("admin stats access", () => {
  test.each(["getActivity", "getOperations", "getBillingSummary"] as const)(
    "%s refuses non-admins",
    async (name: "getActivity" | "getOperations" | "getBillingSummary") => {
      const module = await import("../admin");
      const registered = module[name] as any;
      const handler = registered.handler ?? registered;
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      } as any);
      await expect(handler(ctx, {})).rejects.toThrow("Unauthorized");
    }
  );
});
