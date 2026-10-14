import { describe, expect, mock, test } from "bun:test";
import {
  buildRetentionCohorts,
  type CronHealth,
  cronHealth,
  DAY_MS,
  growthPercent,
  monthlyAmount,
  monthlyPolarFee,
  type SubscriptionLike,
  startOfUtcWeek,
  summarizeAccounts,
  summarizeDailyActivity,
  summarizeDeletionQueue,
  summarizeFunnel,
  summarizeQuarantine,
  summarizeSignupDomains,
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
    // Trials are not revenue yet; a canceling subscription still pays.
    expect(summary.revenue.usd.mrr).toBe(1000);
    expect(summary.revenue.usd.mrrAtRisk).toBe(500);
    expect(summary.revenue.usd.trialMrr).toBe(400);
    expect(summary.plans.map((plan) => [plan.productId, plan.count])).toEqual([
      ["p_month", 2],
      ["p_year", 1],
    ]);
  });
});

describe("admin stats access", () => {
  test.each(["getActivity", "getOperations"] as const)(
    "%s refuses non-admins",
    async (name: "getActivity" | "getOperations") => {
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

describe("monthly revenue", () => {
  const base = {
    status: "active",
    currency: "usd",
    cancelAtPeriodEnd: false,
    product: { id: "p", name: "Pro" },
  };

  test.each([
    ["no discount", { amount: 1000, recurringInterval: "month" }, 1000],
    ["a yearly price", { amount: 12_000, recurringInterval: "year" }, 1000],
    [
      "a forever percentage discount",
      {
        amount: 1000,
        recurringInterval: "month",
        discount: {
          type: "percentage",
          basisPoints: 2500,
          duration: "forever",
        },
      },
      750,
    ],
    [
      "a repeating fixed discount",
      {
        amount: 1000,
        recurringInterval: "month",
        discount: { type: "fixed", amount: 300, duration: "repeating" },
      },
      700,
    ],
    [
      "a one-time discount, which only touches the first invoice",
      {
        amount: 1000,
        recurringInterval: "month",
        discount: { type: "percentage", basisPoints: 5000, duration: "once" },
      },
      1000,
    ],
    [
      "a discount larger than the price",
      {
        amount: 500,
        recurringInterval: "month",
        discount: { type: "fixed", amount: 900, duration: "forever" },
      },
      0,
    ],
  ] as [string, Omit<SubscriptionLike, keyof typeof base>, number][])(
    "counts %s",
    (_name: string, fields: Omit<
      SubscriptionLike,
      keyof typeof base
    >, expected: number) => {
      expect(monthlyAmount({ ...base, ...fields })).toBeCloseTo(expected);
    }
  );

  test("estimates Polar's fee as 4% plus 40 cents per payment", () => {
    expect(
      monthlyPolarFee({ ...base, amount: 1000, recurringInterval: "month" })
    ).toBeCloseTo(80);
    // A yearly plan pays the fixed part once a year.
    expect(
      monthlyPolarFee({ ...base, amount: 12_000, recurringInterval: "year" })
    ).toBeCloseTo(40 + 40 / 12);
  });

  test("past-due subscriptions are at risk, not revenue", () => {
    const summary = summarizeSubscriptions([
      { ...base, amount: 1000, recurringInterval: "month" },
      { ...base, status: "past_due", amount: 1000, recurringInterval: "month" },
    ]);
    expect(summary.revenue.usd).toMatchObject({ mrr: 1000, mrrAtRisk: 1000 });
    expect(summary.paying).toBe(1);
    expect(summary.pastDue).toBe(1);
    expect(summary.revenue.usd.netMrr).toBe(920);
  });
});

describe("growthPercent", () => {
  test.each([
    [110, 100, 10],
    [90, 100, -10],
    [5, 0, null],
  ] as [number, number, number | null][])(
    "%d against %d is %p",
    (current: number, previous: number, expected: number | null) => {
      const result = growthPercent(current, previous);
      if (expected === null) {
        expect(result).toBeNull();
      } else {
        expect(result).toBeCloseTo(expected);
      }
    }
  );
});

describe("buildRetentionCohorts", () => {
  // Wednesday; its week starts Monday 2026-10-12.
  const now = day("2026-10-14");

  test("weeks start on Monday UTC", () => {
    expect(startOfUtcWeek(now)).toBe(day("2026-10-12", 0));
    expect(startOfUtcWeek(day("2026-10-11", 23))).toBe(day("2026-10-05", 0));
  });

  test("shares each cohort's active accounts per week since signup", () => {
    const cohorts = buildRetentionCohorts(
      [
        { signedUpAt: day("2026-09-29"), activeWeeks: [0, 1, 2] },
        { signedUpAt: day("2026-09-30"), activeWeeks: [0] },
        { signedUpAt: day("2026-10-13"), activeWeeks: [0] },
      ],
      { now, weeks: 3 }
    );

    expect(cohorts.map((cohort) => [cohort.week, cohort.size])).toEqual([
      ["2026-09-28", 2],
      ["2026-10-05", 0],
      ["2026-10-12", 1],
    ]);
    expect(cohorts[0].retention).toEqual([1, 0.5, 0.5]);
    // Weeks that have not started yet are null, not zero.
    expect(cohorts[2].retention).toEqual([1, null, null]);
  });
});

describe("summarizeFunnel", () => {
  test("counts each step and only judges week-two return when it has passed", () => {
    expect(
      summarizeFunnel([
        {
          savedFirstCard: true,
          activated: true,
          returnedWeek2: true,
          subscribed: true,
        },
        {
          savedFirstCard: true,
          activated: false,
          returnedWeek2: false,
          subscribed: false,
        },
        {
          savedFirstCard: false,
          activated: false,
          returnedWeek2: null,
          subscribed: false,
        },
      ])
    ).toEqual({
      signedUp: 3,
      savedFirstCard: 2,
      activated: 1,
      returnedWeek2: 1,
      eligibleForWeek2: 2,
      subscribed: 1,
    });
  });
});

describe("summarizeSignupDomains", () => {
  const now = day("2026-10-14");

  test("flags throwaway domains and bursts from one company domain", () => {
    const burst = Array.from({ length: 5 }, (_, index) => ({
      email: `bot${index}@spammy.io`,
      createdAt: now - index * 1000,
    }));
    const domains = summarizeSignupDomains(
      [
        ...burst,
        ...Array.from({ length: 8 }, (_, index) => ({
          email: `person${index}@gmail.com`,
          createdAt: now - index * 1000,
        })),
        { email: "x@mailinator.com", createdAt: now - 3 * DAY_MS },
      ],
      now
    );

    const byDomain = Object.fromEntries(
      domains.map((domain) => [domain.domain, domain])
    );
    expect(byDomain["spammy.io"]).toMatchObject({ spike: true, lastDay: 5 });
    expect(byDomain["mailinator.com"]).toMatchObject({
      disposable: true,
      lastDay: 0,
    });
    // Shared inbox providers are never a burst.
    expect(byDomain["gmail.com"]).toMatchObject({ spike: false, total: 8 });
    // Flagged domains sort first.
    expect(
      domains
        .slice(0, 2)
        .map((domain) => domain.domain)
        .sort()
    ).toEqual(["mailinator.com", "spammy.io"]);
  });
});

describe("cronHealth", () => {
  const now = day("2026-10-14");
  const hourly = 60 * 60 * 1000;

  test.each([
    ["never ran", undefined, "never_ran"],
    [
      "failed last time",
      {
        lastStatus: "failed",
        lastStartedAt: now - 1000,
        lastSucceededAt: now - 2000,
      },
      "failing",
    ],
    [
      "succeeded recently",
      {
        lastStatus: "succeeded",
        lastStartedAt: now - 1000,
        lastSucceededAt: now - 1000,
      },
      "ok",
    ],
    [
      "has not succeeded in over two schedules",
      {
        lastStatus: "succeeded",
        lastStartedAt: now - 3 * hourly,
        lastSucceededAt: now - 3 * hourly,
      },
      "late",
    ],
    [
      "is in a run that started recently",
      {
        lastStatus: "running",
        lastStartedAt: now - 1000,
        lastSucceededAt: now - 3 * hourly,
      },
      "running",
    ],
  ] as [string, Parameters<typeof cronHealth>[0], CronHealth][])(
    "a cron that %s is %s",
    (_name: string, heartbeat: Parameters<
      typeof cronHealth
    >[0], expected: CronHealth) => {
      expect(cronHealth(heartbeat, hourly, now)).toBe(expected);
    }
  );
});
