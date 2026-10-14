import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import {
  ensureAdmin,
  isAutoInternalAccount,
  readAdminSettings,
} from "./adminAccess";
import { createPolarClient, readCustomerSubscriptions } from "./adminBilling";
import {
  ACTIVATION_CARD_THRESHOLD,
  ACTIVATION_WINDOW_DAYS,
  buildRetentionCohorts,
  type CohortMember,
  DAY_MS,
  type FunnelMember,
  startOfUtcDay,
  startOfUtcWeek,
  summarizeFunnel,
  summarizeSubscriptions,
  utcDay,
} from "./adminStats";
import { readHasPremium } from "./auth";
import { ONBOARDING_CARD_CONTENTS } from "./card/defaultCards";

// Business metrics for the superadmin console: the daily snapshot that gives
// every number a history, and the live growth view (weekly active savers,
// cohort retention, the signup funnel, and who signed up). Internal and test
// accounts are left out everywhere. "Saved" means a card created by the
// account, onboarding cards excluded, dated by when it reached Teak.

const USER_PAGE = 1000;
const CARD_PAGE = 500;
const PAGE_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 400;
const FLAG_BATCH = 200;
const COHORT_WEEKS = 12;
const COHORT_LIMIT = 3000;
const COHORT_BATCH = 20;
const RECENT_SIGNUPS = 50;
const TOP_STORAGE = 20;
const SNAPSHOT_LIST_LIMIT = 400;

const isOnboardingCard = (card: Pick<Doc<"cards">, "content">) =>
  ONBOARDING_CARD_CONTENTS.includes(
    card.content as (typeof ONBOARDING_CARD_CONTENTS)[number]
  );

interface Page<T> {
  continueCursor: string;
  isDone: boolean;
  rows: T[];
}

interface UserRow {
  createdAt: number;
  deleted: boolean;
  email: string;
  isAdmin: boolean;
  teakUserId: string;
}

interface CardRow {
  createdAt: number;
  deleted: boolean;
  fileSize: number;
  userId: string;
}

export const usersPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    since: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, since }): Promise<Page<UserRow>> => {
    const result = await ctx.db
      .query("users")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", since ?? 0))
      .paginate({ cursor, numItems: USER_PAGE });
    return {
      rows: result.page.map((user) => ({
        teakUserId: user.teakUserId,
        email: user.email,
        isAdmin: user.role === "admin",
        createdAt: user._creationTime,
        deleted: user.deletedAt !== undefined,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const cardsPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    since: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, since }): Promise<Page<CardRow>> => {
    const result = await ctx.db
      .query("cards")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", since ?? 0))
      .paginate({ cursor, numItems: CARD_PAGE, maximumBytesRead: PAGE_BYTES });
    return {
      rows: result.page
        .filter((card) => !isOnboardingCard(card))
        .map((card) => ({
          userId: card.userId,
          createdAt: card._creationTime,
          deleted: card.isDeleted === true,
          fileSize: card.fileMetadata?.fileSize ?? 0,
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

async function readAll<T>(
  readPage: (cursor: string | null) => Promise<Page<T>>
): Promise<{ rows: T[]; isComplete: boolean }> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await readPage(cursor);
    rows.push(...result.rows);
    if (result.isDone) {
      return { rows, isComplete: true };
    }
    cursor = result.continueCursor;
  }
  return { rows, isComplete: false };
}

const readUsers = (ctx: Pick<ActionCtx, "runQuery">, since?: number) =>
  readAll(
    (cursor): Promise<Page<UserRow>> =>
      ctx.runQuery(internal.adminMetrics.usersPage, { cursor, since })
  );

const readCards = (ctx: Pick<ActionCtx, "runQuery">, since?: number) =>
  readAll(
    (cursor): Promise<Page<CardRow>> =>
      ctx.runQuery(internal.adminMetrics.cardsPage, { cursor, since })
  );

const flagAutoInternal = async (
  ctx: Pick<ActionCtx, "runMutation">,
  users: UserRow[]
) => {
  const ids = users
    .filter((user) =>
      isAutoInternalAccount({
        email: user.email,
        role: user.isAdmin ? "admin" : undefined,
      })
    )
    .map((user) => user.teakUserId);
  let flagged = 0;
  for (let i = 0; i < ids.length; i += FLAG_BATCH) {
    flagged += await ctx.runMutation(
      internal.adminAccess.flagAutoInternalAccounts,
      { teakUserIds: ids.slice(i, i + FLAG_BATCH) }
    );
  }
  return flagged;
};

/** Flags admins, e2e and reserved-domain accounts as internal. */
export const flagInternalAccounts = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const users = await readUsers(ctx);
    return await flagAutoInternal(ctx, users.rows);
  },
});

const readInternalIds = async (
  ctx: Pick<ActionCtx, "runQuery">
): Promise<Set<string>> => {
  const ids: string[] = await ctx.runQuery(
    internal.adminAccess.listInternalUserIds,
    {}
  );
  return new Set(ids);
};

/* Daily snapshot ---------------------------------------------------------- */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Saves one UTC day's metrics. Defaults to yesterday. Totals (accounts,
 * cards, storage) are as of the end of that day; billing is only recorded
 * when the day is yesterday or today, since Polar only reports the present.
 */
export const captureDailySnapshot = internalAction({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }): Promise<{ date: string }> => {
    const now = Date.now();
    const day = date ?? utcDay(now - DAY_MS);
    if (!DATE_PATTERN.test(day)) {
      throw new Error("Snapshot date must be YYYY-MM-DD");
    }
    const dayStart = Date.parse(`${day}T00:00:00.000Z`);
    const dayEnd = dayStart + DAY_MS;
    if (Number.isNaN(dayStart) || dayStart > now) {
      throw new Error("Snapshot date must not be in the future");
    }

    const users = await readUsers(ctx);
    await flagAutoInternal(ctx, users.rows);
    const internalIds = await readInternalIds(ctx);
    const customers = users.rows.filter(
      (user) => !internalIds.has(user.teakUserId)
    );
    const accounts = customers.filter(
      (user) => !user.deleted && user.createdAt < dayEnd
    ).length;
    const signups = customers.filter(
      (user) => user.createdAt >= dayStart && user.createdAt < dayEnd
    ).length;

    const cards = await readCards(ctx);
    let totalCards = 0;
    let cardsSaved = 0;
    let storageBytes = 0;
    let storageBytesAdded = 0;
    const savers1d = new Set<string>();
    const savers7d = new Set<string>();
    const savers28d = new Set<string>();
    const storageByUser = new Map<string, number>();
    for (const card of cards.rows) {
      if (internalIds.has(card.userId) || card.createdAt >= dayEnd) {
        continue;
      }
      if (!card.deleted) {
        totalCards += 1;
        storageBytes += card.fileSize;
        if (card.fileSize > 0) {
          storageByUser.set(
            card.userId,
            (storageByUser.get(card.userId) ?? 0) + card.fileSize
          );
        }
      }
      if (card.createdAt >= dayStart) {
        cardsSaved += 1;
        storageBytesAdded += card.fileSize;
        savers1d.add(card.userId);
      }
      if (card.createdAt >= dayEnd - 7 * DAY_MS) {
        savers7d.add(card.userId);
      }
      if (card.createdAt >= dayEnd - 28 * DAY_MS) {
        savers28d.add(card.userId);
      }
    }
    const topStorage = [...storageByUser.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_STORAGE)
      .map(([teakUserId, bytes]) => ({ teakUserId, bytes }));

    const usage: Array<{ userId: string; calls: number; costUsd: number }> =
      await ctx.runQuery(internal.adminUsage.usageForDay, { date: day });
    let aiCostUsd = 0;
    let aiCalls = 0;
    for (const row of usage) {
      if (!internalIds.has(row.userId)) {
        aiCostUsd += row.costUsd;
        aiCalls += row.calls;
      }
    }

    let billing: Doc<"adminDailyMetrics">["billing"];
    let billingComplete = true;
    const polar = createPolarClient();
    if (polar && now - dayEnd < DAY_MS) {
      const { subscriptions, isComplete } = await readCustomerSubscriptions(
        ctx,
        polar
      );
      billingComplete = isComplete;
      const summary = summarizeSubscriptions(subscriptions);
      const currency =
        "usd" in summary.revenue
          ? "usd"
          : (Object.keys(summary.revenue)[0] ?? "usd");
      const revenue = summary.revenue[currency];
      billing = {
        currency,
        mrr: revenue?.mrr ?? 0,
        mrrAtRisk: revenue?.mrrAtRisk ?? 0,
        netMrr: revenue?.netMrr ?? 0,
        paying: summary.paying,
        trialing: summary.trialing,
        pastDue: summary.pastDue,
        canceling: summary.canceling,
      };
    }

    await ctx.runMutation(internal.adminMetrics.writeSnapshot, {
      snapshot: {
        date: day,
        capturedAt: now,
        accounts,
        signups,
        cardsSaved,
        totalCards,
        activeSavers1d: savers1d.size,
        activeSavers7d: savers7d.size,
        activeSavers28d: savers28d.size,
        storageBytes,
        storageBytesAdded,
        aiCostUsd,
        aiCalls,
        ...(billing ? { billing } : {}),
        topStorage,
        isApproximate: !(
          users.isComplete &&
          cards.isComplete &&
          billingComplete
        ),
      },
    });
    return { date: day };
  },
});

const snapshotValidator = v.object({
  date: v.string(),
  capturedAt: v.number(),
  accounts: v.number(),
  signups: v.number(),
  cardsSaved: v.number(),
  totalCards: v.number(),
  activeSavers1d: v.number(),
  activeSavers7d: v.number(),
  activeSavers28d: v.number(),
  storageBytes: v.number(),
  storageBytesAdded: v.number(),
  aiCostUsd: v.number(),
  aiCalls: v.number(),
  billing: v.optional(
    v.object({
      currency: v.string(),
      mrr: v.number(),
      mrrAtRisk: v.number(),
      netMrr: v.number(),
      paying: v.number(),
      trialing: v.number(),
      pastDue: v.number(),
      canceling: v.number(),
    })
  ),
  topStorage: v.array(v.object({ teakUserId: v.string(), bytes: v.number() })),
  isApproximate: v.boolean(),
});

/** One row per date: a later capture of the same day replaces it. */
export const writeSnapshot = internalMutation({
  args: { snapshot: snapshotValidator },
  returns: v.null(),
  handler: async (ctx, { snapshot }) => {
    const existing = await ctx.db
      .query("adminDailyMetrics")
      .withIndex("by_date", (q) => q.eq("date", snapshot.date))
      .unique();
    if (existing) {
      // A recapture of an older day keeps the billing it saw at the time.
      await ctx.db.replace("adminDailyMetrics", existing._id, {
        ...snapshot,
        ...(snapshot.billing || !existing.billing
          ? {}
          : { billing: existing.billing }),
      });
    } else {
      await ctx.db.insert("adminDailyMetrics", snapshot);
    }
    return null;
  },
});

/** Captures a day now instead of waiting for the nightly run. */
export const captureSnapshot = action({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }): Promise<{ date: string }> => {
    const actor = await ensureAdmin(ctx);
    const result: { date: string } = await ctx.runAction(
      internal.adminMetrics.captureDailySnapshot,
      date === undefined ? {} : { date }
    );
    await ctx.runMutation(internal.adminAccess.recordAudit, {
      actor,
      action: "metrics.capture_snapshot",
      details: { date: result.date },
    });
    return result;
  },
});

export const listSnapshots = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    await ensureAdmin(ctx);
    const span = Math.min(
      Math.max(Math.floor(days ?? 120), 1),
      SNAPSHOT_LIST_LIMIT
    );
    const since = utcDay(startOfUtcDay(Date.now()) - span * DAY_MS);
    const rows = await ctx.db
      .query("adminDailyMetrics")
      .withIndex("by_date", (q) => q.gte("date", since))
      .take(SNAPSHOT_LIST_LIMIT);
    return rows.map(({ _id, _creationTime, ...row }) => row);
  },
});

/* Growth ------------------------------------------------------------------ */

interface CohortActivity extends CohortMember, FunnelMember {
  cardsFirstWeek: number;
  teakUserId: string;
}

/**
 * For each account: which weeks since signup it saved a card in, and how far
 * it got through the funnel. Reads only small index ranges per account.
 */
export const cohortActivity = internalQuery({
  args: {
    users: v.array(v.object({ teakUserId: v.string(), createdAt: v.number() })),
    now: v.number(),
    weeks: v.number(),
  },
  handler: async (ctx, { users, now, weeks }): Promise<CohortActivity[]> => {
    const savedIn = async (userId: string, from: number, to: number) => {
      const rows = await ctx.db
        .query("cards")
        .withIndex("by_created", (q) =>
          q.eq("userId", userId).gte("createdAt", from).lt("createdAt", to)
        )
        .take(ACTIVATION_CARD_THRESHOLD + ONBOARDING_CARD_CONTENTS.length);
      return rows.filter((card) => !isOnboardingCard(card)).length;
    };
    const results: CohortActivity[] = [];
    for (const user of users) {
      const signupWeek = startOfUtcWeek(user.createdAt);
      const activeWeeks: number[] = [];
      for (let offset = 0; offset < weeks; offset++) {
        const from = Math.max(signupWeek + offset * 7 * DAY_MS, user.createdAt);
        const to = signupWeek + (offset + 1) * 7 * DAY_MS;
        if (from > now) {
          break;
        }
        if ((await savedIn(user.teakUserId, from, to)) > 0) {
          activeWeeks.push(offset);
        }
      }
      const windowMs = ACTIVATION_WINDOW_DAYS * DAY_MS;
      const cardsFirstWeek = await savedIn(
        user.teakUserId,
        user.createdAt,
        user.createdAt + windowMs
      );
      const savedAny =
        cardsFirstWeek > 0 ||
        (await savedIn(user.teakUserId, user.createdAt, now + 1)) > 0;
      results.push({
        teakUserId: user.teakUserId,
        signedUpAt: user.createdAt,
        activeWeeks,
        cardsFirstWeek,
        savedFirstCard: savedAny,
        activated:
          user.createdAt <= now - windowMs &&
          cardsFirstWeek >= ACTIVATION_CARD_THRESHOLD,
        returnedWeek2:
          user.createdAt > now - 2 * windowMs
            ? null
            : (await savedIn(
                user.teakUserId,
                user.createdAt + windowMs,
                user.createdAt + 2 * windowMs
              )) > 0,
        subscribed: await readHasPremium(ctx, user.teakUserId),
      });
    }
    return results;
  },
});

/**
 * The growth view: weekly active savers and signups against the week before,
 * weekly cohort retention, the signup funnel, and the latest signups.
 */
export const getGrowth = action({
  args: {},
  handler: async (ctx): Promise<Record<string, unknown>> => {
    await ensureAdmin(ctx);
    const now = Date.now();
    const internalIds = await readInternalIds(ctx);

    const recentCards = await readCards(ctx, now - 14 * DAY_MS);
    const thisWeek = new Set<string>();
    const lastWeek = new Set<string>();
    let cardsThisWeek = 0;
    let cardsLastWeek = 0;
    for (const card of recentCards.rows) {
      if (internalIds.has(card.userId)) {
        continue;
      }
      if (card.createdAt >= now - 7 * DAY_MS) {
        thisWeek.add(card.userId);
        cardsThisWeek += 1;
      } else {
        lastWeek.add(card.userId);
        cardsLastWeek += 1;
      }
    }

    const cohortStart = startOfUtcWeek(now) - (COHORT_WEEKS - 1) * 7 * DAY_MS;
    const users = await readUsers(ctx, cohortStart);
    const members = users.rows
      .filter((user) => !(user.deleted || internalIds.has(user.teakUserId)))
      .sort((a, b) => b.createdAt - a.createdAt);
    const cohort = members.slice(0, COHORT_LIMIT);
    const activity: CohortActivity[] = [];
    for (let i = 0; i < cohort.length; i += COHORT_BATCH) {
      activity.push(
        ...(await ctx.runQuery(internal.adminMetrics.cohortActivity, {
          users: cohort
            .slice(i, i + COHORT_BATCH)
            .map(({ teakUserId, createdAt }) => ({ teakUserId, createdAt })),
          now,
          weeks: COHORT_WEEKS,
        }))
      );
    }
    const byId = new Map(activity.map((row) => [row.teakUserId, row]));

    const signupsThisWeek = members.filter(
      (user) => user.createdAt >= now - 7 * DAY_MS
    ).length;
    const signupsLastWeek = members.filter(
      (user) =>
        user.createdAt >= now - 14 * DAY_MS && user.createdAt < now - 7 * DAY_MS
    ).length;

    return {
      generatedAt: now,
      weeklyActiveSavers: { current: thisWeek.size, previous: lastWeek.size },
      cardsSaved: { current: cardsThisWeek, previous: cardsLastWeek },
      signups: { current: signupsThisWeek, previous: signupsLastWeek },
      cohorts: buildRetentionCohorts(activity, { now, weeks: COHORT_WEEKS }),
      funnel: {
        windowWeeks: COHORT_WEEKS,
        activationThreshold: ACTIVATION_CARD_THRESHOLD,
        activationWindowDays: ACTIVATION_WINDOW_DAYS,
        ...summarizeFunnel(activity),
      },
      recentSignups: members.slice(0, RECENT_SIGNUPS).map((user) => {
        const row = byId.get(user.teakUserId);
        return {
          teakUserId: user.teakUserId,
          email: user.email,
          createdAt: user.createdAt,
          cardsFirstWeek: row?.cardsFirstWeek ?? 0,
          activated: row?.activated ?? false,
          subscribed: row?.subscribed ?? false,
        };
      }),
      isApproximate:
        !(recentCards.isComplete && users.isComplete) ||
        members.length > COHORT_LIMIT,
    };
  },
});

/** Settings the home view needs alongside growth. */
export const getHomeSettings = query({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);
    const settings = await readAdminSettings(ctx);
    return {
      primaryMetric: settings.primaryMetric,
      weeklyGrowthTargetPct: settings.weeklyGrowthTargetPct,
    };
  },
});
