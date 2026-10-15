import type { Doc } from "./_generated/dataModel";
import type { ProcessingStageKey } from "./card/processingStatus";
import { CRONS } from "./cronSchedules";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVATION_CARD_THRESHOLD = 5;
export const ACTIVATION_WINDOW_DAYS = 7;
const OVERDUE_RETRY_MS = 12 * CRONS.redriveAccountDeletion.everyMs;
const STAGE_KEYS: ProcessingStageKey[] = [
  "classify",
  "categorize",
  "metadata",
  "renderables",
];

export interface DailyActivity {
  aiRuns: number;
  cards: number;
  date: string;
  fileBytes: number;
  files: number;
  signups: number;
}

export interface ActivityRow {
  aiCompletedAt: number[];
  createdAt: number;
  fileSize?: number;
}

export const toActivityRow = (
  card: Pick<Doc<"cards">, "createdAt" | "fileMetadata" | "processingStatus">
): ActivityRow => {
  const aiCompletedAt: number[] = [];
  for (const stage of STAGE_KEYS) {
    const status = card.processingStatus?.[stage];
    if (status?.status === "completed" && status.completedAt !== undefined) {
      aiCompletedAt.push(status.completedAt);
    }
  }
  return {
    createdAt: card.createdAt,
    fileSize: card.fileMetadata?.fileSize,
    aiCompletedAt,
  };
};

export const utcDay = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);

export const startOfUtcDay = (timestamp: number) =>
  Date.parse(`${utcDay(timestamp)}T00:00:00.000Z`);

export function summarizeDailyActivity({
  since,
  now,
  signupTimes,
  cards,
}: {
  since: number;
  now: number;
  signupTimes: number[];
  cards: ActivityRow[];
}): DailyActivity[] {
  const days: DailyActivity[] = [];
  const byDate = new Map<string, DailyActivity>();
  for (let day = startOfUtcDay(since); day <= now; day += DAY_MS) {
    const entry = {
      date: utcDay(day),
      signups: 0,
      cards: 0,
      files: 0,
      fileBytes: 0,
      aiRuns: 0,
    };
    days.push(entry);
    byDate.set(entry.date, entry);
  }
  const bucket = (timestamp: number | undefined) =>
    timestamp !== undefined && timestamp >= since && timestamp <= now
      ? byDate.get(utcDay(timestamp))
      : undefined;

  for (const time of signupTimes) {
    const entry = bucket(time);
    if (entry) {
      entry.signups += 1;
    }
  }
  for (const card of cards) {
    const created = bucket(card.createdAt);
    if (created) {
      created.cards += 1;
      if (typeof card.fileSize === "number" && card.fileSize > 0) {
        created.files += 1;
        created.fileBytes += card.fileSize;
      }
    }
    for (const completedAt of card.aiCompletedAt) {
      const entry = bucket(completedAt);
      if (entry) {
        entry.aiRuns += 1;
      }
    }
  }
  return days;
}

export function summarizeAccounts(
  users: Pick<Doc<"users">, "deletedAt" | "workosUserId">[]
) {
  let linked = 0;
  let unlinked = 0;
  let deleted = 0;
  for (const user of users) {
    if (user.deletedAt !== undefined) {
      deleted += 1;
    } else if (user.workosUserId === undefined) {
      unlinked += 1;
    } else {
      linked += 1;
    }
  }
  return { total: users.length, linked, unlinked, deleted };
}

export function summarizeQuarantine(
  rows: Pick<Doc<"migrationQuarantine">, "reason">[]
) {
  const byReason: Record<string, number> = {};
  for (const row of rows) {
    byReason[row.reason] = (byReason[row.reason] ?? 0) + 1;
  }
  return { unresolved: rows.length, byReason };
}

export function summarizeDeletionQueue(
  states: Pick<
    Doc<"accountDeletionStates">,
    "failureCode" | "nextAttemptAt" | "startedAt"
  >[],
  now: number
) {
  let retrying = 0;
  let needsAttention = 0;
  let overdue = 0;
  let oldestStartedAt: number | null = null;
  for (const state of states) {
    if (state.failureCode) {
      retrying += 1;
      if (state.failureCode.endsWith("storage_source_changed")) {
        needsAttention += 1;
      }
    }
    if (
      state.nextAttemptAt !== undefined &&
      state.nextAttemptAt < now - OVERDUE_RETRY_MS
    ) {
      overdue += 1;
    }
    if (oldestStartedAt === null || state.startedAt < oldestStartedAt) {
      oldestStartedAt = state.startedAt;
    }
  }
  return {
    inProgress: states.length,
    retrying,
    needsAttention,
    overdue,
    oldestStartedAt,
  };
}

export interface SubscriptionLike {
  amount: number;
  cancelAtPeriodEnd: boolean;
  currency: string;
  discount?: SubscriptionDiscountLike | null;
  product: { id: string; name: string };
  recurringInterval: string;
  recurringIntervalCount?: number;
  status: string;
}

export interface SubscriptionDiscountLike {
  amount?: number;
  basisPoints?: number;
  duration: string;
  type: string;
}

const MONTHS_PER_INTERVAL: Record<string, number> = {
  day: 1 / 30,
  week: 12 / 52,
  month: 1,
  year: 12,
};

// Polar's merchant-of-record fee per payment: 4% + 40¢ (USD), from
// https://polar.sh/docs/merchant-of-record/fees. An estimate: payout, refund
// and international card surcharges are not included.
export const POLAR_FEE_RATE = 0.04;
export const POLAR_FEE_FIXED_MINOR = 40;

/**
 * What one subscription brings in per month, in minor units, after a
 * discount that keeps applying (`forever` or `repeating`). One-time discounts
 * only touch the first invoice, so they are left out.
 */
export const monthlyAmount = (subscription: SubscriptionLike): number => {
  const months =
    (MONTHS_PER_INTERVAL[subscription.recurringInterval] ?? 1) *
    Math.max(subscription.recurringIntervalCount ?? 1, 1);
  let amount = subscription.amount;
  const discount = subscription.discount;
  if (discount && discount.duration !== "once") {
    if (typeof discount.basisPoints === "number") {
      amount -= (amount * discount.basisPoints) / 10_000;
    } else if (typeof discount.amount === "number") {
      amount -= discount.amount;
    }
  }
  return Math.max(amount, 0) / months;
};

export const monthlyPolarFee = (subscription: SubscriptionLike): number => {
  const months =
    (MONTHS_PER_INTERVAL[subscription.recurringInterval] ?? 1) *
    Math.max(subscription.recurringIntervalCount ?? 1, 1);
  const perMonth = monthlyAmount(subscription);
  if (perMonth === 0) {
    return 0;
  }
  return perMonth * POLAR_FEE_RATE + POLAR_FEE_FIXED_MINOR / months;
};

export interface CurrencyRevenue {
  mrr: number;
  mrrAtRisk: number;
  netMrr: number;
  trialMrr: number;
}

export type RevenueStatus = "paying" | "trialing" | "past_due" | "other";

export const revenueStatus = (status: string): RevenueStatus => {
  if (status === "active") {
    return "paying";
  }
  if (status === "trialing") {
    return "trialing";
  }
  if (status === "past_due" || status === "unpaid") {
    return "past_due";
  }
  return "other";
};

export function summarizeSubscriptions(subscriptions: SubscriptionLike[]) {
  const byStatus: Record<string, number> = {};
  const revenue: Record<string, CurrencyRevenue> = {};
  const plans = new Map<
    string,
    {
      productId: string;
      name: string;
      interval: string;
      amount: number;
      currency: string;
      count: number;
      mrr: number;
    }
  >();
  let canceling = 0;
  let paying = 0;
  let trialing = 0;
  let pastDue = 0;

  for (const subscription of subscriptions) {
    byStatus[subscription.status] = (byStatus[subscription.status] ?? 0) + 1;
    const currency = subscription.currency.toLowerCase();
    const totals = revenue[currency] ?? {
      mrr: 0,
      mrrAtRisk: 0,
      netMrr: 0,
      trialMrr: 0,
    };
    revenue[currency] = totals;
    const perMonth = monthlyAmount(subscription);
    const kind = revenueStatus(subscription.status);
    if (kind === "paying") {
      paying += 1;
      totals.mrr += perMonth;
      totals.netMrr += perMonth - monthlyPolarFee(subscription);
      if (subscription.cancelAtPeriodEnd) {
        canceling += 1;
        totals.mrrAtRisk += perMonth;
      }
    } else if (kind === "trialing") {
      trialing += 1;
      totals.trialMrr += perMonth;
    } else if (kind === "past_due") {
      pastDue += 1;
      totals.mrrAtRisk += perMonth;
    }

    const key = `${subscription.product.id}:${subscription.recurringInterval}`;
    const plan = plans.get(key) ?? {
      productId: subscription.product.id,
      name: subscription.product.name,
      interval: subscription.recurringInterval,
      amount: subscription.amount,
      currency,
      count: 0,
      mrr: 0,
    };
    plan.count += 1;
    if (kind === "paying") {
      plan.mrr += perMonth;
    }
    plans.set(key, plan);
  }

  for (const totals of Object.values(revenue)) {
    totals.mrr = Math.round(totals.mrr);
    totals.mrrAtRisk = Math.round(totals.mrrAtRisk);
    totals.netMrr = Math.round(totals.netMrr);
    totals.trialMrr = Math.round(totals.trialMrr);
  }

  return {
    total: subscriptions.length,
    paying,
    trialing,
    pastDue,
    canceling,
    byStatus,
    revenue,
    plans: [...plans.values()]
      .map((plan) => ({ ...plan, mrr: Math.round(plan.mrr) }))
      .sort((a, b) => b.count - a.count),
  };
}

export const growthPercent = (
  current: number,
  previous: number
): number | null =>
  previous > 0 ? ((current - previous) / previous) * 100 : null;

export const startOfUtcWeek = (timestamp: number) => {
  const day = startOfUtcDay(timestamp);
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return day - weekday * DAY_MS;
};

export interface CohortMember {
  activeWeeks: number[];
  signedUpAt: number;
}

export interface RetentionCohort {
  retention: Array<number | null>;
  size: number;
  week: string;
}

export function buildRetentionCohorts(
  members: CohortMember[],
  { now, weeks }: { now: number; weeks: number }
): RetentionCohort[] {
  const currentWeek = startOfUtcWeek(now);
  const cohorts: RetentionCohort[] = [];
  for (let index = weeks - 1; index >= 0; index--) {
    const weekStart = currentWeek - index * 7 * DAY_MS;
    const inCohort = members.filter(
      (member) => startOfUtcWeek(member.signedUpAt) === weekStart
    );
    const elapsedWeeks = index;
    const retention: Array<number | null> = [];
    for (let offset = 0; offset < weeks; offset++) {
      if (offset > elapsedWeeks || inCohort.length === 0) {
        retention.push(offset > elapsedWeeks ? null : 0);
        continue;
      }
      const active = inCohort.filter((member) =>
        member.activeWeeks.includes(offset)
      ).length;
      retention.push(active / inCohort.length);
    }
    cohorts.push({
      week: utcDay(weekStart),
      size: inCohort.length,
      retention,
    });
  }
  return cohorts;
}

export interface FunnelMember {
  activated: boolean;
  returnedWeek2: boolean | null;
  savedFirstCard: boolean;
  subscribed: boolean;
}

export function summarizeFunnel(members: FunnelMember[]) {
  const eligibleWeek2 = members.filter(
    (member) => member.returnedWeek2 !== null
  );
  return {
    signedUp: members.length,
    savedFirstCard: members.filter((member) => member.savedFirstCard).length,
    activated: members.filter((member) => member.activated).length,
    returnedWeek2: eligibleWeek2.filter((member) => member.returnedWeek2)
      .length,
    eligibleForWeek2: eligibleWeek2.length,
    subscribed: members.filter((member) => member.subscribed).length,
  };
}

export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "getnada.com",
  "guerrillamail.com",
  "maildrop.cc",
  "mailinator.com",
  "mohmal.com",
  "sharklasers.com",
  "temp-mail.org",
  "tempmail.com",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
]);

const SHARED_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "icloud.com",
  "me.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
  "hey.com",
  "fastmail.com",
]);

export const SIGNUP_SPIKE_THRESHOLD = 5;

export interface SignupDomain {
  disposable: boolean;
  domain: string;
  lastDay: number;
  spike: boolean;
  total: number;
}

export function summarizeSignupDomains(
  signups: Array<{ createdAt: number; email: string }>,
  now: number
): SignupDomain[] {
  const byDomain = new Map<string, SignupDomain>();
  for (const signup of signups) {
    const domain = signup.email.split("@").pop()?.toLowerCase() ?? "";
    if (!domain) {
      continue;
    }
    const entry = byDomain.get(domain) ?? {
      domain,
      total: 0,
      lastDay: 0,
      disposable: DISPOSABLE_EMAIL_DOMAINS.has(domain),
      spike: false,
    };
    entry.total += 1;
    if (signup.createdAt >= now - DAY_MS) {
      entry.lastDay += 1;
    }
    byDomain.set(domain, entry);
  }
  for (const entry of byDomain.values()) {
    entry.spike =
      !SHARED_EMAIL_DOMAINS.has(entry.domain) &&
      entry.lastDay >= SIGNUP_SPIKE_THRESHOLD;
  }
  return [...byDomain.values()].sort(
    (a, b) =>
      Number(b.disposable || b.spike) - Number(a.disposable || a.spike) ||
      b.total - a.total
  );
}

export type CronHealth = "ok" | "late" | "failing" | "running" | "never_ran";

export function cronHealth(
  heartbeat:
    | {
        lastStatus: "running" | "succeeded" | "failed";
        lastStartedAt: number;
        lastSucceededAt?: number;
      }
    | undefined,
  expectedEveryMs: number,
  now: number
): CronHealth {
  if (!heartbeat) {
    return "never_ran";
  }
  if (heartbeat.lastStatus === "failed") {
    return "failing";
  }
  const lastGood = heartbeat.lastSucceededAt ?? 0;
  if (now - lastGood > expectedEveryMs * 2) {
    return heartbeat.lastStatus === "running" &&
      now - heartbeat.lastStartedAt < expectedEveryMs
      ? "running"
      : "late";
  }
  return "ok";
}
