import { AI_PIPELINE_STAGES } from "@teak/files-protocol";
import type { Doc, Id } from "../_generated/dataModel";
import type { ProcessingStatus } from "../shared/processingStatus";
import { DAY_MS, startOfUtcDay, startOfUtcWeek, utcDay } from "./dates";

export const ACTIVATION_CARD_THRESHOLD = 5;
export const ACTIVATION_WINDOW_DAYS = 7;
const OVERDUE_RETRY_MS = 60 * 60 * 1000;

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
  for (const stage of AI_PIPELINE_STAGES) {
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

export interface SnapshotBilling {
  canceling: number;
  currency: string;
  mrr: number;
  mrrAtRisk: number;
  netMrr: number;
  pastDue: number;
  paying: number;
  trialing: number;
}

/** The snapshot's billing line, in USD unless no subscription is in USD. */
export const snapshotBilling = (
  subscriptions: SubscriptionLike[]
): SnapshotBilling => {
  const summary = summarizeSubscriptions(subscriptions);
  const currency =
    "usd" in summary.revenue
      ? "usd"
      : (Object.keys(summary.revenue)[0] ?? "usd");
  const revenue = summary.revenue[currency];
  return {
    currency,
    mrr: revenue?.mrr ?? 0,
    mrrAtRisk: revenue?.mrrAtRisk ?? 0,
    netMrr: revenue?.netMrr ?? 0,
    paying: summary.paying,
    trialing: summary.trialing,
    pastDue: summary.pastDue,
    canceling: summary.canceling,
  };
};

type MetadataStatus = "pending" | "completed" | "failed";
type OverviewStage = (typeof AI_PIPELINE_STAGES)[number];

export interface OverviewCardRow {
  cardId: Id<"cards">;
  createdAt: number;
  creationTime: number;
  deleted: boolean;
  fileSize: number;
  hasAiSummary: boolean;
  hasAiTags: boolean;
  hasAiTranscript: boolean;
  metadataStatus?: MetadataStatus;
  onboarding: boolean;
  processingStatus?: ProcessingStatus;
  type: string;
  userId: string;
}

export const toOverviewCardRow = (
  card: Pick<
    Doc<"cards">,
    | "_creationTime"
    | "_id"
    | "aiSummary"
    | "aiTags"
    | "aiTranscriptCharCount"
    | "createdAt"
    | "fileMetadata"
    | "isDeleted"
    | "metadataStatus"
    | "processingStatus"
    | "type"
    | "userId"
  >,
  onboarding: boolean
): OverviewCardRow => ({
  cardId: card._id,
  userId: card.userId,
  type: card.type ?? "unknown",
  createdAt: card.createdAt,
  creationTime: card._creationTime,
  deleted: card.isDeleted === true,
  fileSize: card.fileMetadata?.fileSize ?? 0,
  onboarding,
  hasAiSummary: Boolean(card.aiSummary),
  hasAiTags: Boolean(card.aiTags && card.aiTags.length > 0),
  hasAiTranscript: card.aiTranscriptCharCount !== undefined,
  ...(card.metadataStatus ? { metadataStatus: card.metadataStatus } : {}),
  ...(card.processingStatus ? { processingStatus: card.processingStatus } : {}),
});

export interface StageSummary {
  failed: number;
  inProgress: number;
  pending: number;
}

export interface MissingCardSummary {
  cardId: Id<"cards">;
  createdAt: number;
  metadataStatus?: MetadataStatus;
  processingStatus?: ProcessingStatus;
  reasons: string[];
  type: string;
}

export interface AdminOverview {
  aiPipeline: {
    failedCards: number;
    missingAiMetadata: number;
    missingCards: MissingCardSummary[];
    pendingEnrichment: number;
    stageSummaries: Record<OverviewStage, StageSummary>;
  };
  cardsByType: Record<string, number>;
  generatedAt: number;
  growth: { createdLastSevenDays: number; createdLastThirtyDays: number };
  isApproximate: boolean;
  metadataStatus: Record<MetadataStatus | "unset", number>;
  totals: {
    activeCards: number;
    deletedCards: number;
    totalCards: number;
    uniqueUsers: number;
  };
}

const MAX_MISSING_CARDS = 50;

/**
 * Counts the admin overview one card at a time, so the Worker's scan and
 * `admin:getOverview`'s fallback count the same way. Cards go in creation
 * order; the first 50 with something missing are listed.
 */
export const createOverviewTally = (now: number) => {
  const sevenDaysAgo = now - 7 * DAY_MS;
  const thirtyDaysAgo = now - 30 * DAY_MS;
  const cardsByType: Record<string, number> = {};
  const metadataStatus: AdminOverview["metadataStatus"] = {
    pending: 0,
    completed: 0,
    failed: 0,
    unset: 0,
  };
  const stageSummaries = {} as Record<OverviewStage, StageSummary>;
  for (const stage of AI_PIPELINE_STAGES) {
    stageSummaries[stage] = { pending: 0, inProgress: 0, failed: 0 };
  }
  let totalCards = 0;
  let activeCards = 0;
  let deletedCards = 0;
  let createdLastSevenDays = 0;
  let createdLastThirtyDays = 0;
  let missingAiMetadata = 0;
  let pendingEnrichment = 0;
  let failedCards = 0;
  const missingCards: MissingCardSummary[] = [];
  const uniqueUsers = new Set<string>();

  const countStages = (card: OverviewCardRow) => {
    const processing = card.processingStatus;
    if (!processing) {
      return;
    }
    let hasFailure = false;
    let isRunning = false;
    for (const stage of AI_PIPELINE_STAGES) {
      const status = processing[stage]?.status;
      if (status === "failed") {
        stageSummaries[stage].failed += 1;
        hasFailure = true;
      } else if (status === "pending") {
        stageSummaries[stage].pending += 1;
        isRunning = true;
      } else if (status === "in_progress") {
        stageSummaries[stage].inProgress += 1;
        isRunning = true;
      }
    }
    if (hasFailure && !card.deleted) {
      failedCards += 1;
    }
    if (isRunning && !card.deleted) {
      pendingEnrichment += 1;
    }
  };

  const add = (card: OverviewCardRow) => {
    const isDeleted = card.deleted;
    totalCards += 1;
    if (isDeleted) {
      deletedCards += 1;
    } else {
      activeCards += 1;
      metadataStatus[card.metadataStatus ?? "unset"] += 1;
      if (card.createdAt >= sevenDaysAgo) {
        createdLastSevenDays += 1;
      }
      if (card.createdAt >= thirtyDaysAgo) {
        createdLastThirtyDays += 1;
      }
    }
    uniqueUsers.add(card.userId);
    cardsByType[card.type] = (cardsByType[card.type] ?? 0) + 1;

    const reasons: string[] = [];
    if (!(card.hasAiSummary || card.hasAiTags || card.hasAiTranscript)) {
      if (!isDeleted) {
        missingAiMetadata += 1;
      }
      reasons.push("AI metadata missing");
    }
    if (!card.hasAiSummary) {
      reasons.push("AI summary missing");
    }
    if (!card.hasAiTags) {
      reasons.push("AI tags missing");
    }
    if (card.type === "link" && card.metadataStatus === "pending") {
      reasons.push("Link metadata still pending");
    }
    if (
      !isDeleted &&
      reasons.length > 0 &&
      missingCards.length < MAX_MISSING_CARDS
    ) {
      missingCards.push({
        cardId: card.cardId,
        type: card.type,
        createdAt: card.createdAt,
        ...(card.metadataStatus ? { metadataStatus: card.metadataStatus } : {}),
        ...(card.processingStatus
          ? { processingStatus: card.processingStatus }
          : {}),
        reasons,
      });
    }
    countStages(card);
  };

  const finish = (isApproximate: boolean): AdminOverview => ({
    generatedAt: now,
    totals: {
      totalCards,
      activeCards,
      deletedCards,
      uniqueUsers: uniqueUsers.size,
    },
    growth: { createdLastSevenDays, createdLastThirtyDays },
    cardsByType,
    metadataStatus,
    aiPipeline: {
      missingAiMetadata,
      pendingEnrichment,
      failedCards,
      stageSummaries,
      missingCards,
    },
    isApproximate,
  });

  return { add, finish };
};
