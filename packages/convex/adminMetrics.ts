import { adminSnapshotInstanceId } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import {
  ACTIVATION_CARD_THRESHOLD,
  ACTIVATION_WINDOW_DAYS,
  autoInternalUserIds,
  buildRetentionCohorts,
  type CohortMember,
  DAY_MS,
  type FunnelMember,
  type MetricsCardRow,
  type MetricsUserRow,
  type SnapshotBilling,
  snapshotBilling,
  snapshotDay,
  startOfUtcDay,
  startOfUtcWeek,
  summarizeFunnel,
  utcDay,
} from "./admin/stats";
import { ensureAdmin, readAdminSettings, writeAudit } from "./adminAccess";
import { createPolarClient, readCustomerSubscriptions } from "./adminBilling";
import { readHasPremium } from "./auth";
import { isOnboardingCard, ONBOARDING_CARDS } from "./card/defaultCards";
import { queueMaintenanceWorkflow } from "./workflowDispatch";

const USER_PAGE = 1000;
const CARD_PAGE = 500;
const PAGE_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 400;
const FLAG_BATCH = 200;
const COHORT_WEEKS = 12;
const COHORT_LIMIT = 3000;
const COHORT_BATCH = 20;
const RECENT_SIGNUPS = 50;
const SNAPSHOT_LIST_LIMIT = 400;

interface Page<T> {
  continueCursor: string;
  isDone: boolean;
  rows: T[];
}

type UserRow = MetricsUserRow;
type CardRow = MetricsCardRow;

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
  const ids = autoInternalUserIds(users);
  let flagged = 0;
  for (let i = 0; i < ids.length; i += FLAG_BATCH) {
    flagged += await ctx.runMutation(
      internal.adminAccess.flagAutoInternalAccounts,
      { teakUserIds: ids.slice(i, i + FLAG_BATCH) }
    );
  }
  return flagged;
};

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

const billingValidator = v.object({
  currency: v.string(),
  mrr: v.number(),
  mrrAtRisk: v.number(),
  netMrr: v.number(),
  paying: v.number(),
  trialing: v.number(),
  pastDue: v.number(),
  canceling: v.number(),
});

/**
 * The daily snapshot's billing line. The Core Worker counts everything else
 * (`admin-snapshot` maintenance task); Polar's token stays in Convex.
 */
export const readSnapshotBilling = internalAction({
  args: {},
  returns: v.object({
    billing: v.union(billingValidator, v.null()),
    isComplete: v.boolean(),
  }),
  handler: async (
    ctx
  ): Promise<{ billing: SnapshotBilling | null; isComplete: boolean }> => {
    const polar = createPolarClient();
    if (!polar) {
      return { billing: null, isComplete: true };
    }
    const { subscriptions, isComplete } = await readCustomerSubscriptions(
      ctx,
      polar
    );
    return { billing: snapshotBilling(subscriptions), isComplete };
  },
});

/**
 * Starts the Core Worker's snapshot of `date` (yesterday by default). The
 * row lands in `adminDailyMetrics` when that run finishes.
 */
export const queueSnapshot = internalMutation({
  args: {
    actor: v.optional(v.object({ teakUserId: v.string(), email: v.string() })),
    date: v.optional(v.string()),
  },
  returns: v.object({ date: v.string() }),
  handler: async (ctx, { actor, date }) => {
    const now = Date.now();
    const { day } = snapshotDay(date, now);
    await queueMaintenanceWorkflow(ctx, adminSnapshotInstanceId(day, now), {
      date: day,
      task: "admin-snapshot",
    });
    if (actor) {
      await writeAudit(ctx, actor, {
        action: "metrics.capture_snapshot",
        details: { date: day },
      });
    }
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
  billing: v.optional(billingValidator),
  topStorage: v.array(v.object({ teakUserId: v.string(), bytes: v.number() })),
  isApproximate: v.boolean(),
});

export const writeSnapshot = internalMutation({
  args: { snapshot: snapshotValidator },
  returns: v.null(),
  handler: async (ctx, { snapshot }) => {
    const existing = await ctx.db
      .query("adminDailyMetrics")
      .withIndex("by_date", (q) => q.eq("date", snapshot.date))
      .unique();
    if (existing) {
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

// The snapshot is counted by the Core Worker, so it lands shortly after
// this returns rather than before.
export const captureSnapshot = action({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }): Promise<{ date: string }> => {
    const actor = await ensureAdmin(ctx);
    return await ctx.runMutation(internal.adminMetrics.queueSnapshot, {
      actor,
      ...(date === undefined ? {} : { date }),
    });
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

interface CohortActivity extends CohortMember, FunnelMember {
  cardsFirstWeek: number;
  teakUserId: string;
}

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
        .take(ACTIVATION_CARD_THRESHOLD + ONBOARDING_CARDS.length);
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
