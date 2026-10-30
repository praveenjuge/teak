import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import {
  ACTIVATION_CARD_THRESHOLD,
  ACTIVATION_WINDOW_DAYS,
  type ActivityRow,
  type AdminOverview,
  createOverviewTally,
  DAY_MS,
  type OverviewCardRow,
  startOfUtcDay,
  summarizeAccounts,
  summarizeDailyActivity,
  summarizeDeletionQueue,
  toActivityRow,
  toOverviewCardRow,
} from "./admin/stats";
import {
  ensureAdmin,
  readAdminActor,
  readInternalUserIds,
  readUserFlags,
  requireReason,
  writeAdminSettings,
  writeAudit,
} from "./adminAccess";
import { readHasPremium } from "./auth";
import { getActiveCardCount, getCardUsageSnapshot } from "./card/cardUsage";
import { isOnboardingCard, ONBOARDING_CARDS } from "./card/defaultCards";
import { stagePending } from "./card/processingStatus";
import { patchCardWithSearchSync } from "./card/searchSync";
import { clearCardTranscript } from "./card/textContents";
import { adminOverviewFields } from "./schema";
import { readComponentUser } from "./securitySessions";
import { normalizeIdentityEmail } from "./shared/workosIds";
import { tryResolveObjectUrl } from "./storage/fileUrls";
import { queueObjectDeletion } from "./storage/r2";
import { queueCardProcessing } from "./workflowDispatch";

// Before the Core Worker has stored an overview, `getOverview` counts at
// most this many cards itself.
const ADMIN_OVERVIEW_LIMIT = 10_000;
const OVERVIEW_CARD_PAGE = 500;
const OVERVIEW_PAGE_BYTES = 4 * 1024 * 1024;
const ADMIN_LIST_LIMIT = 200;
const MAX_ACTIVITY_DAYS = 90;
const ACTIVATION_COHORT_LIMIT = 1000;
// Summed with the legacy account count, these stay well under the
// per-query document and byte limits.
const OPERATIONS_USER_LIMIT = 8000;
const OPERATIONS_QUEUE_LIMIT = 2000;

const clampPagination = (paginationOpts: {
  cursor: string | null;
  numItems: number;
}) => ({
  ...paginationOpts,
  numItems: Math.min(paginationOpts.numItems, ADMIN_LIST_LIMIT),
});

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewImageUrl?: string;
};

const attachCardUrls = async (
  _ctx: QueryCtx,
  cards: Doc<"cards">[]
): Promise<CardWithUrls[]> =>
  Promise.all(
    cards.map(async (card) => {
      const [fileUrl, thumbnailUrl, screenshotUrl, linkPreviewImageUrl] =
        await Promise.all([
          card.fileKey
            ? tryResolveObjectUrl(
                card.fileKey,
                card.fileMetadata?.fileName ?? null
              )
            : Promise.resolve(null),
          card.thumbnailKey
            ? tryResolveObjectUrl(card.thumbnailKey)
            : Promise.resolve(null),
          card.metadata?.linkPreview?.screenshotStorageKey
            ? tryResolveObjectUrl(
                card.metadata.linkPreview.screenshotStorageKey
              )
            : Promise.resolve(null),
          card.metadata?.linkPreview?.imageStorageKey
            ? tryResolveObjectUrl(card.metadata.linkPreview.imageStorageKey)
            : Promise.resolve(null),
        ]);

      return {
        ...card,
        fileUrl: fileUrl || undefined,
        thumbnailUrl: thumbnailUrl || undefined,
        screenshotUrl: screenshotUrl || undefined,
        linkPreviewImageUrl: linkPreviewImageUrl || undefined,
      };
    })
  );

// A premium account past the free cap can hold an inexact usage count, for
// which getActiveCardCount scans only up to the cap; its shard total is the
// better lower bound.
const readCardsCount = async (
  ctx: QueryCtx,
  userId: string
): Promise<number> => {
  const usage = await getCardUsageSnapshot(ctx, userId);
  if (usage?.isCountExact) {
    return usage.activeCardCount;
  }
  return Math.max(
    usage?.activeCardCount ?? 0,
    await getActiveCardCount(ctx, userId)
  );
};

export const getAccess = query({
  args: {},
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx) => ({ allowed: (await readAdminActor(ctx)) !== null }),
});

// The Core Worker counts the overview once a day in the same card scan as
// the daily snapshot (`admin-snapshot` maintenance task) and stores it, so
// an open admin page no longer re-reads the cards on every card write. Until
// the first count lands, the overview is counted here from at most
// ADMIN_OVERVIEW_LIMIT cards.
export const getOverview = query({
  args: {
    includeOnboarding: v.optional(v.boolean()),
  },
  handler: async (ctx, { includeOnboarding }): Promise<AdminOverview> => {
    await ensureAdmin(ctx);

    const stored = await ctx.db
      .query("adminOverviews")
      .withIndex("by_includeOnboarding", (q) =>
        q.eq("includeOnboarding", includeOnboarding === true)
      )
      .unique();
    if (stored) {
      const {
        _id,
        _creationTime,
        includeOnboarding: _included,
        ...overview
      } = stored;
      return overview;
    }

    const allCards = await ctx.db.query("cards").take(ADMIN_OVERVIEW_LIMIT);
    const internalIds = await readInternalUserIds(ctx);
    const tally = createOverviewTally(Date.now());
    for (const card of allCards) {
      const onboarding = isOnboardingCard(card);
      if (
        !(internalIds.has(card.userId) || (onboarding && !includeOnboarding))
      ) {
        tally.add(toOverviewCardRow(card, onboarding));
      }
    }
    return tally.finish(allCards.length === ADMIN_OVERVIEW_LIMIT);
  },
});

// The daily snapshot's one card scan: each row carries what both the overview
// and the snapshot count.
export const overviewCardsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (
    ctx,
    { cursor }
  ): Promise<{
    continueCursor: string;
    isDone: boolean;
    rows: OverviewCardRow[];
  }> => {
    const result = await ctx.db.query("cards").paginate({
      cursor,
      numItems: OVERVIEW_CARD_PAGE,
      maximumBytesRead: OVERVIEW_PAGE_BYTES,
    });
    return {
      rows: result.page.map((card) =>
        toOverviewCardRow(card, isOnboardingCard(card))
      ),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const writeOverview = internalMutation({
  args: {
    includeOnboarding: v.boolean(),
    overview: v.object(adminOverviewFields),
  },
  returns: v.null(),
  handler: async (ctx, { includeOnboarding, overview }) => {
    const existing = await ctx.db
      .query("adminOverviews")
      .withIndex("by_includeOnboarding", (q) =>
        q.eq("includeOnboarding", includeOnboarding)
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("adminOverviews", { includeOnboarding, ...overview });
    } else if (existing.generatedAt <= overview.generatedAt) {
      await ctx.db.replace("adminOverviews", existing._id, {
        includeOnboarding,
        ...overview,
      });
    }
    return null;
  },
});

export const redactCard = (card: Doc<"cards">) => ({
  _id: card._id,
  _creationTime: card._creationTime,
  userId: card.userId,
  type: card.type,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
  isDeleted: card.isDeleted,
  deletedAt: card.deletedAt,
  isArchived: card.isArchived,
  isFavorited: card.isFavorited,
  metadataStatus: card.metadataStatus,
  processingStatus: card.processingStatus,
  fileMetadata: card.fileMetadata
    ? {
        mimeType: card.fileMetadata.mimeType,
        fileSize: card.fileMetadata.fileSize,
        width: card.fileMetadata.width,
        height: card.fileMetadata.height,
      }
    : undefined,
  hasFile: card.fileKey !== undefined,
  hasUrl: card.url !== undefined,
  aiTagCount: card.aiTags?.length ?? 0,
  hasAiSummary: Boolean(card.aiSummary),
  hasAiTranscript: card.aiTranscriptCharCount !== undefined,
  isRedacted: true as const,
});

export const listAllCards = query({
  args: {
    paginationOpts: paginationOptsValidator,
    includeOnboarding: v.optional(v.boolean()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { paginationOpts, includeOnboarding, userId }) => {
    await ensureAdmin(ctx);

    const safePagination = clampPagination(paginationOpts);

    const result =
      userId === undefined
        ? await ctx.db.query("cards").order("desc").paginate(safePagination)
        : await ctx.db
            .query("cards")
            .withIndex("by_created", (q) => q.eq("userId", userId))
            .order("desc")
            .paginate(safePagination);

    const filteredPage = includeOnboarding
      ? result.page
      : result.page.filter((card) => !isOnboardingCard(card));

    return {
      ...result,
      page: filteredPage.map(redactCard),
    };
  },
});

export const revealCard = mutation({
  args: { cardId: v.id("cards"), reason: v.string() },
  handler: async (ctx, { cardId, reason }) => {
    const actor = await ensureAdmin(ctx);
    const why = requireReason(reason);
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      throw new Error("Card not found");
    }
    await writeAudit(ctx, actor, {
      action: "card.reveal",
      targetTeakUserId: card.userId,
      targetCardId: cardId,
      reason: why,
    });
    const [revealed] = await attachCardUrls(ctx, [card]);
    return revealed;
  },
});

export const listAllUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { paginationOpts }) => {
    await ensureAdmin(ctx);
    const result = await ctx.db
      .query("users")
      .order("desc")
      .paginate(clampPagination(paginationOpts));
    const page = await Promise.all(
      result.page
        .filter((user) => user.deletedAt === undefined)
        .map(async (user) => {
          const profile = user.workosUserId
            ? await readComponentUser(ctx, user.workosUserId)
            : null;
          const flags = await readUserFlags(ctx, user.teakUserId);
          return {
            id: user.teakUserId,
            email: profile?.email ?? user.email,
            emailVerified: profile?.emailVerified ?? user.emailVerified,
            createdAt: user._creationTime,
            cardsCount: await readCardsCount(ctx, user.teakUserId),
            isPro: await readHasPremium(ctx, user.teakUserId),
            internal: flags?.internal ?? false,
            aiDisabled: flags?.aiDisabled ?? false,
          };
        })
    );
    return { ...result, page };
  },
});

// Activity is read in byte-capped pages from an action, so neither the
// per-transaction document count nor its byte limit is reached.
const ACTIVITY_CARD_PAGE = 500;
const ACTIVITY_USER_PAGE = 1000;
const ACTIVITY_PAGE_BYTES = 4 * 1024 * 1024;
const ACTIVITY_MAX_PAGES = 200;
const ACTIVATION_BATCH_SIZE = 25;

interface ActivityPage<T> {
  continueCursor: string;
  isDone: boolean;
  rows: T[];
}

interface ActivityUser {
  createdAt: number;
  deleted: boolean;
  teakUserId: string;
}

export const activityCardsPage = internalQuery({
  args: { since: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (
    ctx,
    { since, cursor }
  ): Promise<ActivityPage<ActivityRow>> => {
    const result = await ctx.db
      .query("cards")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
      .paginate({
        cursor,
        numItems: ACTIVITY_CARD_PAGE,
        maximumBytesRead: ACTIVITY_PAGE_BYTES,
      });
    const internalIds = await readInternalUserIds(ctx);
    return {
      rows: result.page
        .filter(
          (card) => !(isOnboardingCard(card) || internalIds.has(card.userId))
        )
        .map(toActivityRow),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const activityUsersPage = internalQuery({
  args: { since: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (
    ctx,
    { since, cursor }
  ): Promise<ActivityPage<ActivityUser>> => {
    const result = await ctx.db
      .query("users")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
      .paginate({ cursor, numItems: ACTIVITY_USER_PAGE });
    const internalIds = await readInternalUserIds(ctx);
    return {
      rows: result.page
        .filter((user) => !internalIds.has(user.teakUserId))
        .map((user) => ({
          teakUserId: user.teakUserId,
          createdAt: user._creationTime,
          deleted: user.deletedAt !== undefined,
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const countActivatedUsers = internalQuery({
  args: {
    users: v.array(v.object({ teakUserId: v.string(), createdAt: v.number() })),
  },
  handler: async (ctx, { users }): Promise<number> => {
    const windowMs = ACTIVATION_WINDOW_DAYS * DAY_MS;
    let activated = 0;
    for (const user of users) {
      const firstWeek = await ctx.db
        .query("cards")
        .withIndex("by_created", (q) =>
          q
            .eq("userId", user.teakUserId)
            .gte("createdAt", user.createdAt)
            .lt("createdAt", user.createdAt + windowMs)
        )
        .take(ACTIVATION_CARD_THRESHOLD + ONBOARDING_CARDS.length);
      const saved = firstWeek.filter((card) => !isOnboardingCard(card));
      if (saved.length >= ACTIVATION_CARD_THRESHOLD) {
        activated += 1;
      }
    }
    return activated;
  },
});

async function readAllPages<T>(
  readPage: (cursor: string | null) => Promise<ActivityPage<T>>
): Promise<{ rows: T[]; isComplete: boolean }> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < ACTIVITY_MAX_PAGES; page++) {
    const result = await readPage(cursor);
    rows.push(...result.rows);
    if (result.isDone) {
      return { rows, isComplete: true };
    }
    cursor = result.continueCursor;
  }
  return { rows, isComplete: false };
}

export const getActivity = action({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    await ensureAdmin(ctx);
    const span = Math.min(
      Math.max(Math.floor(days ?? 30), 1),
      MAX_ACTIVITY_DAYS
    );
    const now = Date.now();
    const since = startOfUtcDay(now) - (span - 1) * DAY_MS;

    const cards = await readAllPages(
      (cursor): Promise<ActivityPage<ActivityRow>> =>
        ctx.runQuery(internal.admin.activityCardsPage, { since, cursor })
    );
    const users = await readAllPages(
      (cursor): Promise<ActivityPage<ActivityUser>> =>
        ctx.runQuery(internal.admin.activityUsersPage, { since, cursor })
    );

    const windowMs = ACTIVATION_WINDOW_DAYS * DAY_MS;
    const eligible = users.rows.filter(
      (user) => !user.deleted && user.createdAt <= now - windowMs
    );
    const cohort = eligible.slice(0, ACTIVATION_COHORT_LIMIT);
    let activated = 0;
    for (let i = 0; i < cohort.length; i += ACTIVATION_BATCH_SIZE) {
      const batch = cohort
        .slice(i, i + ACTIVATION_BATCH_SIZE)
        .map(({ teakUserId, createdAt }) => ({ teakUserId, createdAt }));
      const count: number = await ctx.runQuery(
        internal.admin.countActivatedUsers,
        { users: batch }
      );
      activated += count;
    }

    return {
      since,
      days: summarizeDailyActivity({
        since,
        now,
        signupTimes: users.rows.map((user) => user.createdAt),
        cards: cards.rows,
      }),
      activation: {
        cohort: cohort.length,
        activated,
        threshold: ACTIVATION_CARD_THRESHOLD,
        windowDays: ACTIVATION_WINDOW_DAYS,
      },
      isApproximate:
        !(cards.isComplete && users.isComplete) ||
        eligible.length > ACTIVATION_COHORT_LIMIT,
    };
  },
});

export const getOperations = query({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);
    const now = Date.now();
    const users = await ctx.db.query("users").take(OPERATIONS_USER_LIMIT);
    const deletions = await ctx.db
      .query("accountDeletionStates")
      .take(OPERATIONS_QUEUE_LIMIT);

    return {
      accounts: summarizeAccounts(users),
      deletions: summarizeDeletionQueue(deletions, now),
      isApproximate:
        users.length === OPERATIONS_USER_LIMIT ||
        deletions.length === OPERATIONS_QUEUE_LIMIT,
    };
  },
});

export const seedAdmin = internalMutation({
  args: { email: v.string() },
  returns: v.object({ teakUserId: v.string(), role: v.literal("admin") }),
  handler: async (ctx, args) => {
    const email = normalizeIdentityEmail(args.email);
    if (!email) {
      throw new Error("The admin email is required");
    }
    // A deleted account keeps its row and address; only live ones count.
    const rows = (
      await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .order("desc")
        .take(20)
    ).filter(
      (row) => row.deletedAt === undefined && row.workosDeletedAt === undefined
    );
    if (rows.length !== 1) {
      throw new Error("Admin seed requires exactly one active mapped account");
    }
    await ctx.db.patch("users", rows[0]._id, { role: "admin" });
    return { teakUserId: rows[0].teakUserId, role: "admin" as const };
  },
});

/**
 * Pauses or reopens sign-ups for operators without the admin console:
 * `bunx convex run --prod admin:setSignupsPaused '{"paused":true}'`.
 */
export const setSignupsPaused = internalMutation({
  args: { paused: v.boolean() },
  returns: v.object({ signupsPaused: v.boolean() }),
  handler: async (ctx, { paused }) => {
    await writeAdminSettings(ctx, { signupsPaused: paused });
    return { signupsPaused: paused };
  },
});

interface BackfillSummary {
  enqueuedCount: number;
  failedCardIds: Id<"cards">[];
  pendingSampleCount: number;
  requestedAt: number;
}

interface PendingSample {
  cardId: Id<"cards">;
}
interface AiBackfillWorkflowResult {
  enqueuedCount: number;
  failedCardIds: Id<"cards">[];
}

export const resetCardProcessingState = internalMutation({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    clearedThumbnail: v.boolean(),
  }),
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      throw new Error(`Card ${cardId} not found`);
    }

    let clearedThumbnail = false;
    if (card.thumbnailKey) {
      try {
        await queueObjectDeletion(ctx, card.thumbnailKey);
      } catch (error) {
        console.error("[admin] Failed to delete thumbnail during refresh", {
          cardId,
          thumbnailKey: card.thumbnailKey,
          error,
        });
      }
      clearedThumbnail = true;
    }
    if (card.scrubKey) {
      try {
        await queueObjectDeletion(ctx, card.scrubKey);
      } catch (error) {
        console.error("[admin] Failed to delete scrub sprite during refresh", {
          cardId,
          scrubKey: card.scrubKey,
          error,
        });
      }
    }
    const { scrub: _scrub, ...fileMetadata } = card.fileMetadata ?? {};

    const processingStatus = card.processingStatus ?? {};
    const updatedProcessing = {
      ...processingStatus,
      classify: stagePending(),
    };

    await patchCardWithSearchSync(ctx, cardId, {
      thumbnailKey: undefined,
      scrubKey: undefined,
      ...(card.fileMetadata ? { fileMetadata } : {}),
      aiTags: undefined,
      aiSummary: undefined,
      aiLanguage: undefined,
      ...(await clearCardTranscript(ctx, card)),
      aiOcrText: undefined,
      ocrCheckedAt: undefined,
      processingStatus: updatedProcessing,
      updatedAt: Date.now(),
    });
    await queueCardProcessing(ctx, cardId, { refresh: true, reset: true });

    return {
      clearedThumbnail,
    };
  },
});

export const retryAiBackfill = action({
  args: {},
  handler: async (ctx): Promise<BackfillSummary> => {
    const actor = await ensureAdmin(ctx);

    const normalizedResult: AiBackfillWorkflowResult = await ctx.runMutation(
      internal.ai.backfill.retryAiBackfillNow,
      {}
    );

    const pendingSample = (await ctx.runQuery(
      internal.ai.queries.findCardsMissingAi,
      {}
    )) as PendingSample[];

    await ctx.runMutation(internal.adminAccess.recordAudit, {
      actor,
      action: "cards.retry_ai_backfill",
      details: {
        enqueued: normalizedResult.enqueuedCount,
        failed: normalizedResult.failedCardIds.length,
      },
    });

    return {
      requestedAt: Date.now(),
      enqueuedCount: normalizedResult.enqueuedCount,
      pendingSampleCount: pendingSample.length,
      failedCardIds: normalizedResult.failedCardIds,
    };
  },
});

export const refreshCardProcessing = action({
  args: {
    cardId: v.id("cards"),
  },
  handler: async (
    ctx,
    { cardId }
  ): Promise<{
    requestedAt: number;
    success: boolean;
    reason?: "not_found";
  }> => {
    const actor = await ensureAdmin(ctx);

    const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      return {
        requestedAt: Date.now(),
        success: false,
        reason: "not_found",
      };
    }

    await ctx.runMutation(internal.admin.resetCardProcessingState, {
      cardId,
    });

    await ctx.runMutation(internal.adminAccess.recordAudit, {
      actor,
      action: "card.refresh_processing",
      targetTeakUserId: card.userId,
      targetCardId: cardId,
    });

    return {
      requestedAt: Date.now(),
      success: true,
    };
  },
});
