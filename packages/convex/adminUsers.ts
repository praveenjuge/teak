import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalQuery, query } from "./_generated/server";
import { ensureAdmin, readUserFlags } from "./adminAccess";
import { DAY_MS, startOfUtcWeek, utcDay } from "./adminStats";
import { daysAgoDate } from "./adminUsage";
import { readHasPremium } from "./auth";
import { ONBOARDING_CARD_CONTENTS } from "./card/defaultCards";
import { readComponentUser } from "./securitySessions";

// One account at a time for the superadmin console. Returns counts, states
// and timestamps; card content stays private (see admin.revealCard).

const CARD_SCAN_LIMIT = 2000;
const CARD_SCAN_BYTES = 8 * 1024 * 1024;
const RECENT_CARDS = 12;
const USAGE_DAYS_LIMIT = 400;
const JOBS_LIMIT = 5;
const AUDIT_LIMIT = 20;
const ACTIVITY_WEEKS = 12;
const STAGES = ["classify", "categorize", "metadata", "renderables"] as const;

const isOnboardingCard = (card: Pick<Doc<"cards">, "content">) =>
  ONBOARDING_CARD_CONTENTS.includes(
    card.content as (typeof ONBOARDING_CARD_CONTENTS)[number]
  );

/** Emails for a handful of accounts, for tables that list people. */
export const emailsFor = internalQuery({
  args: { teakUserIds: v.array(v.string()) },
  handler: async (ctx, { teakUserIds }) => {
    const emails: Record<string, string> = {};
    for (const teakUserId of teakUserIds.slice(0, 200)) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
        .unique();
      if (user) {
        emails[teakUserId] = user.email;
      }
    }
    return emails;
  },
});

export const getUserDetail = query({
  args: { teakUserId: v.string() },
  handler: async (ctx, { teakUserId }) => {
    await ensureAdmin(ctx);
    const now = Date.now();
    const user = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
      .unique();
    if (!user) {
      return null;
    }
    const profile = user.workosUserId
      ? await readComponentUser(ctx, user.workosUserId)
      : null;
    const flags = await readUserFlags(ctx, teakUserId);

    const subscriptions = await ctx.runQuery(
      components.polar.lib.listAllUserSubscriptions,
      { userId: teakUserId }
    );
    const isPro = await readHasPremium(ctx, teakUserId);

    const cardsPage = await ctx.db
      .query("cards")
      .withIndex("by_created", (q) => q.eq("userId", teakUserId))
      .order("desc")
      .paginate({
        cursor: null,
        numItems: CARD_SCAN_LIMIT,
        maximumBytesRead: CARD_SCAN_BYTES,
      });
    const cards = cardsPage.page.filter((card) => !isOnboardingCard(card));

    const byType: Record<string, number> = {};
    let active = 0;
    let deleted = 0;
    let archived = 0;
    let favorited = 0;
    let storageBytes = 0;
    let failedCards = 0;
    let processingCards = 0;
    let firstSavedAt: number | null = null;
    let lastSavedAt: number | null = null;
    const weekStart = startOfUtcWeek(now);
    const weekly = new Array<number>(ACTIVITY_WEEKS).fill(0);
    for (const card of cards) {
      firstSavedAt = Math.min(
        firstSavedAt ?? card._creationTime,
        card._creationTime
      );
      lastSavedAt = Math.max(lastSavedAt ?? 0, card._creationTime);
      const weeksAgo = Math.floor(
        (weekStart - startOfUtcWeek(card._creationTime)) / (7 * DAY_MS)
      );
      if (weeksAgo >= 0 && weeksAgo < ACTIVITY_WEEKS) {
        weekly[ACTIVITY_WEEKS - 1 - weeksAgo] += 1;
      }
      if (card.isDeleted) {
        deleted += 1;
        continue;
      }
      active += 1;
      byType[card.type] = (byType[card.type] ?? 0) + 1;
      archived += card.isArchived ? 1 : 0;
      favorited += card.isFavorited ? 1 : 0;
      storageBytes += card.fileMetadata?.fileSize ?? 0;
      const statuses = STAGES.map(
        (stage) => card.processingStatus?.[stage]?.status
      );
      if (statuses.includes("failed")) {
        failedCards += 1;
      } else if (
        statuses.includes("pending") ||
        statuses.includes("in_progress")
      ) {
        processingCards += 1;
      }
    }

    const usageRows = await ctx.db
      .query("aiUsageDaily")
      .withIndex("by_userId_and_date", (q) => q.eq("userId", teakUserId))
      .order("desc")
      .take(USAGE_DAYS_LIMIT);
    const since30 = daysAgoDate(29, now);
    const ai = { costUsd: 0, calls: 0, costUsd30d: 0, calls30d: 0, errors: 0 };
    for (const row of usageRows) {
      ai.costUsd += row.costUsd;
      ai.calls += row.calls;
      ai.errors += row.errors;
      if (row.date >= since30) {
        ai.costUsd30d += row.costUsd;
        ai.calls30d += row.calls;
      }
    }

    const exportJobs = await ctx.db
      .query("exportJobs")
      .withIndex("by_user_created", (q) => q.eq("userId", teakUserId))
      .order("desc")
      .take(JOBS_LIMIT);
    const importJobs = await ctx.db
      .query("importJobs")
      .withIndex("by_user_created", (q) => q.eq("userId", teakUserId))
      .order("desc")
      .take(JOBS_LIMIT);
    const deletion = await ctx.db
      .query("accountDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", teakUserId))
      .first();
    const audit = await ctx.db
      .query("adminAuditLog")
      .withIndex("by_targetTeakUserId_and_at", (q) =>
        q.eq("targetTeakUserId", teakUserId)
      )
      .order("desc")
      .take(AUDIT_LIMIT);

    return {
      generatedAt: now,
      account: {
        teakUserId,
        email: profile?.email ?? user.email,
        emailVerified: profile?.emailVerified ?? user.emailVerified,
        name:
          [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
          null,
        createdAt: user._creationTime,
        deletedAt: user.deletedAt ?? null,
        isAdmin: user.role === "admin",
        signInProvider: user.workosUserId ? "workos" : "legacy",
      },
      flags: {
        internal: flags?.internal ?? false,
        aiDisabled: flags?.aiDisabled ?? false,
      },
      billing: {
        isPro,
        subscriptions: subscriptions.map((sub) => ({
          id: sub.id,
          status: sub.status,
          plan: sub.product?.name ?? null,
          amount: sub.amount,
          currency: sub.currency,
          interval: sub.recurringInterval,
          startedAt: sub.startedAt,
          endedAt: sub.endedAt,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          cancellationReason: sub.customerCancellationReason ?? null,
          cancellationComment: sub.customerCancellationComment ?? null,
        })),
      },
      cards: {
        active,
        deleted,
        archived,
        favorited,
        byType,
        storageBytes,
        failedCards,
        processingCards,
        firstSavedAt,
        lastSavedAt,
        weekly: weekly.map((count, index) => ({
          week: utcDay(weekStart - (ACTIVITY_WEEKS - 1 - index) * 7 * DAY_MS),
          cards: count,
        })),
        recent: cards.slice(0, RECENT_CARDS).map((card) => ({
          _id: card._id,
          type: card.type,
          createdAt: card._creationTime,
          isDeleted: card.isDeleted === true,
          metadataStatus: card.metadataStatus ?? null,
          failedStages: STAGES.filter(
            (stage) => card.processingStatus?.[stage]?.status === "failed"
          ),
          fileSize: card.fileMetadata?.fileSize ?? null,
        })),
        isApproximate: !cardsPage.isDone,
      },
      ai,
      jobs: {
        exports: exportJobs.map((job) => ({
          status: job.status,
          createdAt: job.createdAt,
        })),
        imports: importJobs.map((job) => ({
          status: job.status,
          createdAt: job.createdAt,
        })),
      },
      deletion: deletion
        ? {
            startedAt: deletion.startedAt,
            failureCode: deletion.failureCode ?? null,
            nextAttemptAt: deletion.nextAttemptAt ?? null,
          }
        : null,
      audit: audit.map((entry) => ({
        _id: entry._id,
        at: entry.at,
        action: entry.action,
        actorEmail: entry.actorEmail,
        reason: entry.reason ?? null,
        targetCardId: entry.targetCardId ?? null,
        details: entry.details ?? null,
      })),
    };
  },
});
