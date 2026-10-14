import { Polar as PolarBilling } from "@polar-sh/sdk";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  env,
  internalMutation,
  internalQuery,
  type QueryCtx,
  query,
} from "./_generated/server";
import {
  ACTIVATION_CARD_THRESHOLD,
  ACTIVATION_WINDOW_DAYS,
  type ActivityRow,
  DAY_MS,
  type SubscriptionLike,
  startOfUtcDay,
  summarizeAccounts,
  summarizeDailyActivity,
  summarizeDeletionQueue,
  summarizeQuarantine,
  summarizeSubscriptions,
  toActivityRow,
} from "./adminStats";
import { ONBOARDING_CARD_CONTENTS } from "./card/defaultCards";
import type {
  ProcessingStageKey,
  ProcessingStatus,
} from "./card/processingStatus";
import { stagePending } from "./card/processingStatus";
import { patchCardWithSearchSync } from "./card/searchDocumentHelpers";
import { countLegacyBetterAuthUsers } from "./legacyBetterAuth";
import { getSessionUser, readComponentUser } from "./securitySessions";
import { normalizeIdentityEmail } from "./shared/workosIds";
import { tryResolveObjectUrl } from "./storage/fileUrls";
import { deleteObject } from "./storage/r2";

interface StageSummary {
  failed: number;
  inProgress: number;
  pending: number;
}

interface MissingCardSummary {
  cardId: Id<"cards">;
  createdAt: number;
  metadataStatus?: "pending" | "completed" | "failed";
  processingStatus?: ProcessingStatus;
  reasons: string[];
  type: string;
}

const STAGE_KEYS: ProcessingStageKey[] = [
  "classify",
  "categorize",
  "metadata",
  "renderables",
];

const SEVEN_DAYS_IN_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MISSING_CARDS = 50;
// Maximum cards to process in admin overview to prevent memory issues
// For larger datasets, consider denormalizing counters or using pagination
const ADMIN_OVERVIEW_LIMIT = 10_000;
const ADMIN_LIST_LIMIT = 200;
const MAX_ACTIVITY_DAYS = 90;
const ACTIVATION_COHORT_LIMIT = 1000;
// Summed with the legacy account count, these stay well under the
// per-query document and byte limits.
const OPERATIONS_USER_LIMIT = 8000;
const OPERATIONS_QUEUE_LIMIT = 2000;
const SUBSCRIPTION_LIMIT = 5000;

// Helper to check if a card is an onboarding card by its content
const isOnboardingCard = (card: { content: string }): boolean =>
  ONBOARDING_CARD_CONTENTS.includes(
    card.content as (typeof ONBOARDING_CARD_CONTENTS)[number]
  );

type AdminCtx = QueryCtx | ActionCtx;

const hasAdminAccess = async (ctx: AdminCtx): Promise<boolean> => {
  const user = await getSessionUser(ctx);
  if (!user) {
    return false;
  }
  const mapping = await ctx.runQuery(
    internal.securitySessions.identityMapping,
    {
      teakUserId: user.teakUserId,
    }
  );
  return mapping?.role === "admin" && mapping.deletedAt === undefined;
};

const ensureAdmin = async (ctx: AdminCtx) => {
  if (!(await hasAdminAccess(ctx))) {
    throw new Error("Unauthorized");
  }
};

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

const getActiveCardCountForUser = async (
  ctx: QueryCtx,
  userId: string
): Promise<number> => {
  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q) =>
      q.eq("userId", userId).eq("isDeleted", undefined)
    )
    .collect();

  return cards.length;
};

export const getAccess = query({
  args: {},
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx) => ({ allowed: await hasAdminAccess(ctx) }),
});

export const getOverview = query({
  args: {
    includeOnboarding: v.optional(v.boolean()),
  },
  handler: async (ctx, { includeOnboarding }) => {
    await ensureAdmin(ctx);

    const now = Date.now();
    const sevenDaysAgo = now - SEVEN_DAYS_IN_MS;
    const thirtyDaysAgo = now - THIRTY_DAYS_IN_MS;

    const typeCounts: Record<string, number> = {};
    const metadataStatusCounts: Record<
      "pending" | "completed" | "failed" | "unset",
      number
    > = {
      pending: 0,
      completed: 0,
      failed: 0,
      unset: 0,
    };

    const stageSummaries: Record<ProcessingStageKey, StageSummary> =
      STAGE_KEYS.reduce(
        (acc, key) => {
          acc[key] = { pending: 0, inProgress: 0, failed: 0 };
          return acc;
        },
        {} as Record<ProcessingStageKey, StageSummary>
      );

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

    // Use .take() with limit instead of unbounded .collect() to prevent memory issues
    // For production at scale, consider denormalizing these counts into a separate table
    const allCards = await ctx.db.query("cards").take(ADMIN_OVERVIEW_LIMIT);
    // Filter out onboarding cards unless explicitly requested
    const cards = includeOnboarding
      ? allCards
      : allCards.filter((card) => !isOnboardingCard(card));
    const isLimitReached = allCards.length === ADMIN_OVERVIEW_LIMIT;

    for (const card of cards) {
      totalCards += 1;
      const isDeleted = card.isDeleted === true;
      if (isDeleted) {
        deletedCards += 1;
      } else {
        activeCards += 1;
      }

      uniqueUsers.add(card.userId);

      if (card.createdAt >= sevenDaysAgo && !isDeleted) {
        createdLastSevenDays += 1;
      }

      if (card.createdAt >= thirtyDaysAgo && !isDeleted) {
        createdLastThirtyDays += 1;
      }

      const typeKey = card.type ?? "unknown";
      typeCounts[typeKey] = (typeCounts[typeKey] ?? 0) + 1;

      if (!isDeleted) {
        if (card.metadataStatus === "pending") {
          metadataStatusCounts.pending += 1;
        } else if (card.metadataStatus === "completed") {
          metadataStatusCounts.completed += 1;
        } else if (card.metadataStatus === "failed") {
          metadataStatusCounts.failed += 1;
        } else {
          metadataStatusCounts.unset += 1;
        }
      }

      const reasons: string[] = [];

      const hasAiSummary = Boolean(card.aiSummary);
      const hasAiTags = Boolean(card.aiTags && card.aiTags.length > 0);
      const hasAiTranscript = Boolean(card.aiTranscript);
      const hasAnyAiMetadata = hasAiSummary || hasAiTags || hasAiTranscript;

      if (!hasAnyAiMetadata) {
        if (!isDeleted) {
          missingAiMetadata += 1;
        }
        reasons.push("AI metadata missing");
      }

      if (!hasAiSummary) {
        reasons.push("AI summary missing");
      }

      if (!hasAiTags) {
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
          cardId: card._id,
          type: card.type,
          createdAt: card.createdAt,
          metadataStatus: card.metadataStatus,
          processingStatus: card.processingStatus,
          reasons,
        });
      }

      const processing = card.processingStatus;
      if (processing) {
        let hasFailure = false;
        for (const stageKey of STAGE_KEYS) {
          const stageStatus = processing[stageKey];
          if (!stageStatus) {
            continue;
          }

          if (stageStatus.status === "failed") {
            stageSummaries[stageKey].failed += 1;
            hasFailure = true;
          } else if (stageStatus.status === "pending") {
            stageSummaries[stageKey].pending += 1;
          } else if (stageStatus.status === "in_progress") {
            stageSummaries[stageKey].inProgress += 1;
          }
        }

        if (hasFailure && !isDeleted) {
          failedCards += 1;
        }

        if (
          !isDeleted &&
          STAGE_KEYS.some((stageKey) => {
            const stageStatus = processing[stageKey];
            return (
              stageStatus &&
              (stageStatus.status === "pending" ||
                stageStatus.status === "in_progress")
            );
          })
        ) {
          pendingEnrichment += 1;
        }
      }
    }

    return {
      generatedAt: now,
      totals: {
        totalCards,
        activeCards,
        deletedCards,
        uniqueUsers: uniqueUsers.size,
      },
      growth: {
        createdLastSevenDays,
        createdLastThirtyDays,
      },
      cardsByType: typeCounts,
      metadataStatus: metadataStatusCounts,
      aiPipeline: {
        missingAiMetadata,
        pendingEnrichment,
        failedCards,
        stageSummaries,
        missingCards,
      },
      // Warn if we hit the limit - counts may be incomplete
      isApproximate: isLimitReached,
    };
  },
});

export const listAllCards = query({
  args: {
    paginationOpts: paginationOptsValidator,
    includeOnboarding: v.optional(v.boolean()),
  },
  handler: async (ctx, { paginationOpts, includeOnboarding }) => {
    await ensureAdmin(ctx);

    const safePagination = clampPagination(paginationOpts);

    const result = await ctx.db
      .query("cards")
      .order("desc")
      .paginate(safePagination);

    // Filter out onboarding cards unless explicitly requested
    const filteredPage = includeOnboarding
      ? result.page
      : result.page.filter((card) => !isOnboardingCard(card));

    const page = await attachCardUrls(ctx, filteredPage);

    return {
      ...result,
      page,
    };
  },
});

// Teak's own identity table covers accounts from before and after WorkOS.
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
          return {
            id: user.teakUserId,
            email: profile?.email ?? user.email,
            emailVerified: profile?.emailVerified ?? user.emailVerified,
            createdAt: user._creationTime,
            cardsCount: await getActiveCardCountForUser(ctx, user.teakUserId),
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
    return {
      rows: result.page
        .filter((card) => !isOnboardingCard(card))
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
    return {
      rows: result.page.map((user) => ({
        teakUserId: user.teakUserId,
        createdAt: user._creationTime,
        deleted: user.deletedAt !== undefined,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** How many of these accounts saved enough cards in their first week. */
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
        .take(ACTIVATION_CARD_THRESHOLD + ONBOARDING_CARD_CONTENTS.length);
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

/**
 * Daily totals for the last `days` days (new accounts, cards, uploads, AI
 * stage runs on those cards) and the share of new accounts that saved at
 * least five cards in their first week. Onboarding cards are not counted.
 */
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

/** Account migration and account deletion queue totals. */
export const getOperations = query({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);
    const now = Date.now();
    const users = await ctx.db.query("users").take(OPERATIONS_USER_LIMIT);
    const quarantine = await ctx.db
      .query("migrationQuarantine")
      .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
      .take(OPERATIONS_QUEUE_LIMIT);
    const deletions = await ctx.db
      .query("accountDeletionStates")
      .take(OPERATIONS_QUEUE_LIMIT);
    const legacy = await countLegacyBetterAuthUsers(ctx);

    return {
      accounts: summarizeAccounts(users),
      legacyAccounts: legacy.count,
      quarantine: summarizeQuarantine(quarantine),
      deletions: summarizeDeletionQueue(deletions, now),
      isApproximate:
        !legacy.isComplete ||
        users.length === OPERATIONS_USER_LIMIT ||
        quarantine.length === OPERATIONS_QUEUE_LIMIT ||
        deletions.length === OPERATIONS_QUEUE_LIMIT,
    };
  },
});

/** Active subscription totals by status and plan, read from Polar. */
export const getBillingSummary = action({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);
    if (!env.POLAR_ACCESS_TOKEN) {
      return {
        configured: false,
        fetchedAt: Date.now(),
        isApproximate: false,
        ...summarizeSubscriptions([]),
      };
    }
    const polar = new PolarBilling({
      accessToken: env.POLAR_ACCESS_TOKEN,
      server: env.POLAR_SERVER === "production" ? "production" : "sandbox",
    });
    const subscriptions: SubscriptionLike[] = [];
    const pages = await polar.subscriptions.list({ active: true, limit: 100 });
    for await (const page of pages) {
      subscriptions.push(...page.result.items);
      if (subscriptions.length >= SUBSCRIPTION_LIMIT) {
        break;
      }
    }
    return {
      configured: true,
      fetchedAt: Date.now(),
      isApproximate: subscriptions.length >= SUBSCRIPTION_LIMIT,
      ...summarizeSubscriptions(subscriptions),
    };
  },
});

// Operator-only bootstrap, e.g. for a new self-hosted deployment. Runtime
// authorization always uses the stored role.
export const seedAdmin = internalMutation({
  args: { email: v.string() },
  returns: v.object({ teakUserId: v.string(), role: v.literal("admin") }),
  handler: async (ctx, args) => {
    const email = normalizeIdentityEmail(args.email);
    if (!email) {
      throw new Error("The admin email is required");
    }
    const rows = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(2);
    if (rows.length !== 1 || rows[0].deletedAt !== undefined) {
      throw new Error("Admin seed requires exactly one active mapped account");
    }
    await ctx.db.patch("users", rows[0]._id, { role: "admin" });
    return { teakUserId: rows[0].teakUserId, role: "admin" as const };
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
        await deleteObject(ctx, card.thumbnailKey);
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
        await deleteObject(ctx, card.scrubKey);
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
      aiTranscript: undefined,
      processingStatus: updatedProcessing,
      updatedAt: Date.now(),
    });

    return {
      clearedThumbnail,
    };
  },
});

export const retryAiBackfill = action({
  args: {},
  handler: async (ctx): Promise<BackfillSummary> => {
    await ensureAdmin(ctx);

    const workflowResult = (await ctx.runMutation(
      internal.workflows.aiBackfill.startAiBackfillWorkflow,
      { startAsync: false }
    )) as AiBackfillWorkflowResult | { workflowId: string };

    const normalizedResult: AiBackfillWorkflowResult =
      "workflowId" in workflowResult
        ? { enqueuedCount: 0, failedCardIds: [] }
        : workflowResult;

    // Retrieve a sample of outstanding cards to provide context without exposing IDs
    const pendingSample = (await ctx.runQuery(
      internal.ai.queries.findCardsMissingAi,
      {}
    )) as PendingSample[];

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
    await ensureAdmin(ctx);

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

    await ctx.runMutation((internal as any).admin.resetCardProcessingState, {
      cardId,
    });

    await ctx.scheduler.runAfter(
      0,
      (internal as any)["workflows/manager"].startCardProcessingWorkflow,
      { cardId }
    );

    return {
      requestedAt: Date.now(),
      success: true,
    };
  },
});
