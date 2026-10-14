import type { Doc } from "./_generated/dataModel";
import type { ProcessingStageKey } from "./card/processingStatus";

// Pure aggregations behind the admin stats queries. Every result is a count
// or a total; nothing here returns per-account data.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVATION_CARD_THRESHOLD = 5;
export const ACTIVATION_WINDOW_DAYS = 7;
// The redrive cron runs every five minutes; a retry this late was missed.
const OVERDUE_RETRY_MS = 60 * 60 * 1000;
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

type ActivityCard = Pick<
  Doc<"cards">,
  "createdAt" | "fileMetadata" | "processingStatus"
>;

export const utcDay = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);

export const startOfUtcDay = (timestamp: number) =>
  Date.parse(`${utcDay(timestamp)}T00:00:00.000Z`);

/**
 * Per-day totals from `since` through `now`, oldest first: new accounts,
 * cards saved, uploaded files and their bytes, and AI processing stages
 * finished that day.
 */
export function summarizeDailyActivity({
  since,
  now,
  signupTimes,
  cards,
}: {
  since: number;
  now: number;
  signupTimes: number[];
  cards: ActivityCard[];
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
      const size = card.fileMetadata?.fileSize;
      if (typeof size === "number" && size > 0) {
        created.files += 1;
        created.fileBytes += size;
      }
    }
    for (const stage of STAGE_KEYS) {
      const status = card.processingStatus?.[stage];
      const finished = status?.status === "completed" ? status : undefined;
      const entry = bucket(finished?.completedAt);
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
  product: { id: string; name: string };
  recurringInterval: string;
  status: string;
}

const MONTHS_PER_INTERVAL: Record<string, number> = {
  day: 1 / 30,
  week: 12 / 52,
  month: 1,
  year: 12,
};

/** Subscription counts by status and plan, with monthly recurring revenue. */
export function summarizeSubscriptions(subscriptions: SubscriptionLike[]) {
  const byStatus: Record<string, number> = {};
  const monthlyRevenue: Record<string, number> = {};
  const plans = new Map<
    string,
    {
      productId: string;
      name: string;
      interval: string;
      amount: number;
      currency: string;
      count: number;
    }
  >();
  let canceling = 0;

  for (const subscription of subscriptions) {
    byStatus[subscription.status] = (byStatus[subscription.status] ?? 0) + 1;
    if (subscription.cancelAtPeriodEnd) {
      canceling += 1;
    }
    const months = MONTHS_PER_INTERVAL[subscription.recurringInterval] ?? 1;
    const currency = subscription.currency.toLowerCase();
    monthlyRevenue[currency] =
      (monthlyRevenue[currency] ?? 0) + subscription.amount / months;

    const key = `${subscription.product.id}:${subscription.recurringInterval}`;
    const plan = plans.get(key);
    if (plan) {
      plan.count += 1;
    } else {
      plans.set(key, {
        productId: subscription.product.id,
        name: subscription.product.name,
        interval: subscription.recurringInterval,
        amount: subscription.amount,
        currency,
        count: 1,
      });
    }
  }

  for (const currency of Object.keys(monthlyRevenue)) {
    monthlyRevenue[currency] = Math.round(monthlyRevenue[currency]);
  }

  return {
    total: subscriptions.length,
    byStatus,
    canceling,
    monthlyRevenue,
    plans: [...plans.values()].sort((a, b) => b.count - a.count),
  };
}
