import { Polar as PolarBilling } from "@polar-sh/sdk";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  type ActionCtx,
  action,
  env,
  internalQuery,
} from "./_generated/server";
import { ensureAdmin } from "./adminAccess";
import {
  DAY_MS,
  monthlyAmount,
  revenueStatus,
  type SubscriptionLike,
  summarizeSubscriptions,
} from "./adminStats";
import { daysAgoDate, type UsageByUser } from "./adminUsage";
import { readHasPremium } from "./auth";

// Money for the superadmin console, read live from Polar: MRR split into
// collected, at risk and trial; failed payments; churn with reasons; drift
// between Polar and Teak's plan state; and AI cost against revenue.
// Internal and test accounts are left out of every number.

const SUBSCRIPTION_LIMIT = 5000;
const CHURN_WINDOW_DAYS = 90;
const COST_WINDOW_DAYS = 30;
const TOP_USERS = 20;
const LOOKUP_BATCH = 100;

export interface PolarSubscription extends SubscriptionLike {
  canceledAt: Date | null;
  currentPeriodStart: Date;
  customer: {
    email: string;
    externalId?: string | null;
    metadata: Record<string, unknown>;
  };
  customerCancellationComment: string | null;
  customerCancellationReason: string | null;
  endedAt: Date | null;
  endsAt: Date | null;
  id: string;
  pastDueAt?: Date | null;
  startedAt: Date | null;
}

export const createPolarClient = () =>
  env.POLAR_ACCESS_TOKEN
    ? new PolarBilling({
        accessToken: env.POLAR_ACCESS_TOKEN,
        server: env.POLAR_SERVER === "production" ? "production" : "sandbox",
      })
    : null;

// Customers carry the Teak user id in metadata (see billing.ts).
export const subscriptionOwnerId = (
  subscription: Pick<PolarSubscription, "customer">
): string | undefined => {
  const fromMetadata = subscription.customer.metadata.userId;
  return typeof fromMetadata === "string"
    ? fromMetadata
    : (subscription.customer.externalId ?? undefined);
};

export const listPolarSubscriptions = async (
  polar: PolarBilling,
  request: { active: boolean; canceledAtAfter?: Date }
): Promise<{ items: PolarSubscription[]; isComplete: boolean }> => {
  const items: PolarSubscription[] = [];
  const pages = await polar.subscriptions.list({ ...request, limit: 100 });
  for await (const page of pages) {
    items.push(...(page.result.items as unknown as PolarSubscription[]));
    if (items.length >= SUBSCRIPTION_LIMIT) {
      return { items, isComplete: false };
    }
  }
  return { items, isComplete: true };
};

/** Subscriptions owned by customers, with internal accounts removed. */
export const readCustomerSubscriptions = async (
  ctx: Pick<ActionCtx, "runQuery">,
  polar: PolarBilling
): Promise<{
  subscriptions: PolarSubscription[];
  internalIds: Set<string>;
  isCustomer: (subscription: PolarSubscription) => boolean;
  isComplete: boolean;
}> => {
  const internalIds = new Set<string>(
    await ctx.runQuery(internal.adminAccess.listInternalUserIds, {})
  );
  const active = await listPolarSubscriptions(polar, { active: true });
  const isCustomer = (subscription: PolarSubscription) => {
    const owner = subscriptionOwnerId(subscription);
    return owner === undefined || !internalIds.has(owner);
  };
  return {
    subscriptions: active.items.filter(isCustomer),
    internalIds,
    isCustomer,
    isComplete: active.isComplete,
  };
};

/** Teak's view of each subscription and owner, for drift checks. */
export const teakBillingState = internalQuery({
  args: { subscriptionIds: v.array(v.string()), userIds: v.array(v.string()) },
  handler: async (ctx, { subscriptionIds, userIds }) => {
    const subscriptions: Record<string, string | null> = {};
    for (const id of subscriptionIds) {
      const row = await ctx.runQuery(components.polar.lib.getSubscription, {
        id,
      });
      subscriptions[id] = row?.status ?? null;
    }
    const premium: Record<string, boolean> = {};
    for (const userId of userIds) {
      premium[userId] = await readHasPremium(ctx, userId);
    }
    return { subscriptions, premium };
  },
});

const readTeakBillingState = async (
  ctx: Pick<ActionCtx, "runQuery">,
  subscriptionIds: string[],
  userIds: string[]
) => {
  const subscriptions: Record<string, string | null> = {};
  const premium: Record<string, boolean> = {};
  const total = Math.max(subscriptionIds.length, userIds.length);
  for (let i = 0; i < total; i += LOOKUP_BATCH) {
    const batch = await ctx.runQuery(internal.adminBilling.teakBillingState, {
      subscriptionIds: subscriptionIds.slice(i, i + LOOKUP_BATCH),
      userIds: userIds.slice(i, i + LOOKUP_BATCH),
    });
    Object.assign(subscriptions, batch.subscriptions);
    Object.assign(premium, batch.premium);
  }
  return { subscriptions, premium };
};

type DriftKind =
  | "missing_in_teak"
  | "status_mismatch"
  | "paying_not_pro"
  | "pro_without_subscription"
  | "no_teak_user";

export type RevenueResult =
  | { configured: false; fetchedAt: number }
  | ({
      configured: true;
      fetchedAt: number;
      isApproximate: boolean;
    } & ReturnType<typeof summarizeSubscriptions> &
      Record<string, unknown>);

const toIso = (value: Date | null | undefined) =>
  value ? new Date(value).getTime() : null;

export const getRevenue = action({
  args: {},
  handler: async (ctx): Promise<RevenueResult> => {
    await ensureAdmin(ctx);
    const polar = createPolarClient();
    if (!polar) {
      return { configured: false as const, fetchedAt: Date.now() };
    }
    const now = Date.now();
    const { subscriptions, internalIds, isCustomer, isComplete } =
      await readCustomerSubscriptions(ctx, polar);
    const churned = await listPolarSubscriptions(polar, {
      active: false,
      canceledAtAfter: new Date(now - CHURN_WINDOW_DAYS * DAY_MS),
    });
    const churnedCustomers = churned.items.filter(isCustomer);

    const summary = summarizeSubscriptions(subscriptions);

    const failedPayments = subscriptions
      .filter((sub) => revenueStatus(sub.status) === "past_due")
      .map((sub) => ({
        subscriptionId: sub.id,
        teakUserId: subscriptionOwnerId(sub) ?? null,
        email: sub.customer.email,
        plan: sub.product.name,
        status: sub.status,
        monthlyAmount: Math.round(monthlyAmount(sub)),
        currency: sub.currency.toLowerCase(),
        since: toIso(sub.pastDueAt) ?? toIso(sub.currentPeriodStart),
      }))
      .sort((a, b) => (a.since ?? 0) - (b.since ?? 0));

    const cancellations = [
      ...subscriptions.filter((sub) => sub.cancelAtPeriodEnd),
      ...churnedCustomers,
    ].map((sub) => ({
      subscriptionId: sub.id,
      teakUserId: subscriptionOwnerId(sub) ?? null,
      email: sub.customer.email,
      plan: sub.product.name,
      status: sub.status,
      monthlyAmount: Math.round(monthlyAmount(sub)),
      currency: sub.currency.toLowerCase(),
      canceledAt: toIso(sub.canceledAt),
      endsAt: toIso(sub.endedAt) ?? toIso(sub.endsAt),
      reason: sub.customerCancellationReason,
      comment: sub.customerCancellationComment,
    }));
    cancellations.sort((a, b) => (b.canceledAt ?? 0) - (a.canceledAt ?? 0));
    const reasons: Record<string, number> = {};
    for (const entry of cancellations) {
      const reason = entry.reason ?? "not_given";
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }

    const since30 = now - COST_WINDOW_DAYS * DAY_MS;
    const started30 = [...subscriptions, ...churnedCustomers].filter(
      (sub) => (toIso(sub.startedAt) ?? 0) >= since30
    ).length;
    const ended30 = churnedCustomers.filter(
      (sub) => (toIso(sub.endedAt) ?? 0) >= since30
    ).length;

    // Drift: Polar is the source of truth for money; Teak's synced copy
    // decides who gets Pro.
    const payingOwners = new Map<string, PolarSubscription>();
    for (const sub of subscriptions) {
      const owner = subscriptionOwnerId(sub);
      if (owner && revenueStatus(sub.status) === "paying") {
        payingOwners.set(owner, sub);
      }
    }
    const churnedOwners = [
      ...new Set(
        churnedCustomers
          .map((sub) => subscriptionOwnerId(sub))
          .filter(
            (owner): owner is string =>
              owner !== undefined && !payingOwners.has(owner)
          )
      ),
    ];
    const allSubscriptions = [...subscriptions, ...churnedCustomers];
    const teak = await readTeakBillingState(
      ctx,
      allSubscriptions.map((sub) => sub.id),
      [...payingOwners.keys(), ...churnedOwners]
    );
    const drift: Array<{
      kind: DriftKind;
      subscriptionId: string | null;
      teakUserId: string | null;
      email: string | null;
      polarStatus: string | null;
      teakStatus: string | null;
    }> = [];
    for (const sub of allSubscriptions) {
      const owner = subscriptionOwnerId(sub) ?? null;
      const teakStatus = teak.subscriptions[sub.id] ?? null;
      const base = {
        subscriptionId: sub.id,
        teakUserId: owner,
        email: sub.customer.email,
        polarStatus: sub.status,
        teakStatus,
      };
      if (!owner) {
        drift.push({ kind: "no_teak_user", ...base });
      } else if (teakStatus === null) {
        drift.push({ kind: "missing_in_teak", ...base });
      } else if (teakStatus !== sub.status) {
        drift.push({ kind: "status_mismatch", ...base });
      }
    }
    for (const [owner, sub] of payingOwners) {
      if (teak.premium[owner] === false) {
        drift.push({
          kind: "paying_not_pro",
          subscriptionId: sub.id,
          teakUserId: owner,
          email: sub.customer.email,
          polarStatus: sub.status,
          teakStatus: teak.subscriptions[sub.id] ?? null,
        });
      }
    }
    for (const owner of churnedOwners) {
      if (teak.premium[owner]) {
        drift.push({
          kind: "pro_without_subscription",
          subscriptionId: null,
          teakUserId: owner,
          email: null,
          polarStatus: null,
          teakStatus: "active",
        });
      }
    }

    // AI cost against revenue over the last 30 days.
    const usage: { users: UsageByUser[]; isApproximate: boolean } =
      await ctx.runQuery(internal.adminUsage.usageByUserSince, {
        sinceDate: daysAgoDate(COST_WINDOW_DAYS - 1, now),
      });
    const customerUsage = usage.users.filter(
      (row) => !internalIds.has(row.userId)
    );
    let proCostUsd = 0;
    let freeCostUsd = 0;
    let freeUsersWithCost = 0;
    for (const row of customerUsage) {
      if (payingOwners.has(row.userId)) {
        proCostUsd += row.costUsd;
      } else {
        freeCostUsd += row.costUsd;
        freeUsersWithCost += 1;
      }
    }
    const topCost = [...customerUsage]
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, TOP_USERS);
    const emails: Record<string, string> = await ctx.runQuery(
      internal.adminUsers.emailsFor,
      { teakUserIds: topCost.map((row) => row.userId) }
    );

    return {
      configured: true as const,
      fetchedAt: now,
      isApproximate: !(isComplete && churned.isComplete) || usage.isApproximate,
      ...summary,
      failedPayments,
      cancellations: cancellations.slice(0, 100),
      cancellationReasons: reasons,
      movement: { started30, ended30 },
      drift,
      costs: {
        windowDays: COST_WINDOW_DAYS,
        proCostUsd,
        freeCostUsd,
        proUsers: payingOwners.size,
        freeUsersWithCost,
        topUsers: topCost.map((row) => ({
          teakUserId: row.userId,
          email: emails[row.userId] ?? null,
          costUsd: row.costUsd,
          calls: row.calls,
          isPro: payingOwners.has(row.userId),
        })),
      },
    };
  },
});
