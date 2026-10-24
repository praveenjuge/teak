import type {
  FilesLinkCheckOutcome,
  FilesLinkCheckResult,
} from "@teak/files-protocol";
import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
  type QueryCtx,
  query,
} from "../_generated/server";
import { getSessionUser, requireSessionUser } from "../securitySessions";
import { rateLimiter } from "../shared/rateLimits";
import {
  getSafeUrlHostname,
  sanitizeExternalUrl,
} from "../shared/utils/safeUrl";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { getR2Url } from "../storage/fileUrls";

// The dead-link fallback. Opening a link card that has an archived copy goes
// through `/open/<cardId>`, which asks `checkCardLinkForOpen` whether the
// original page is still there. Only a click starts a check: there is no
// crawler. An answer Teak isn't sure of always opens the original.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** An alive answer opens the original without a check for this long. */
export const LINK_CHECK_ALIVE_TTL_MS = 24 * HOUR;
/** A dead answer opens the archived copy without a check for this long. */
export const LINK_CHECK_DEAD_TTL_MS = 6 * HOUR;
/** How long one open holds the check for its card. */
export const LINK_CHECK_CLAIM_MS = 5000;
/** How long a second open waits for the check in flight. */
export const LINK_CHECK_WAIT_MS = 4000;
const LINK_CHECK_POLL_INTERVAL_MS = 250;
/** The Worker answers within 3.5 s; this covers the request around it. */
export const LINK_CHECK_WORKER_TIMEOUT_MS = 4000;
/** An unchanged alive answer is not written again within this long. */
export const LINK_CHECK_ALIVE_REWRITE_MS = HOUR;

const storedOutcomeValidator = v.union(v.literal("alive"), v.literal("dead"));

/**
 * What the open told analytics: a fresh check's outcome, or a cached one.
 * Matches `dead_link_checked` in shared/analytics.ts.
 */
const openOutcomeValidator = v.union(
  v.literal("alive"),
  v.literal("dead"),
  v.literal("unsure"),
  v.literal("cached_alive"),
  v.literal("cached_dead")
);

export const linkOpenTargetValidator = v.union(
  v.object({ target: v.literal("unavailable") }),
  v.object({
    target: v.literal("original"),
    url: v.string(),
    /** Absent when the card has no archived copy, so nothing was checked. */
    outcome: v.optional(openOutcomeValidator),
    reason: v.optional(v.string()),
  }),
  v.object({
    target: v.literal("archive"),
    url: v.string(),
    /** A signed URL for the copy; absent when one couldn't be made. */
    archiveUrl: v.optional(v.string()),
    capturedAt: v.number(),
    kind: v.union(v.literal("full"), v.literal("text_only")),
    sourceHost: v.optional(v.string()),
    outcome: openOutcomeValidator,
    reason: v.optional(v.string()),
  })
);

export type LinkOpenTarget = Infer<typeof linkOpenTargetValidator>;
type OpenOutcome = Infer<typeof openOutcomeValidator>;

const isFresh = (row: Doc<"linkChecks"> | null, now: number) => {
  if (!(row?.outcome && row.checkedAt !== undefined)) {
    return false;
  }
  const ttl =
    row.outcome === "alive" ? LINK_CHECK_ALIVE_TTL_MS : LINK_CHECK_DEAD_TTL_MS;
  return now - row.checkedAt < ttl;
};

const readRow = (ctx: Pick<QueryCtx, "db">, cardId: Id<"cards">) =>
  ctx.db
    .query("linkChecks")
    .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
    .unique();

const archivedCopyValidator = v.object({
  capturedAt: v.number(),
  kind: v.union(v.literal("full"), v.literal("text_only")),
  sourceHost: v.optional(v.string()),
  storageKey: v.string(),
});

const checkStateValidator = v.union(
  v.object({ kind: v.literal("unavailable") }),
  v.object({ kind: v.literal("original"), url: v.string() }),
  v.object({
    kind: v.literal("archive"),
    archive: archivedCopyValidator,
    cardId: v.id("cards"),
    /** A fresh alive or dead answer, if there is one. */
    cached: v.union(
      v.null(),
      v.object({
        outcome: storedOutcomeValidator,
        reason: v.optional(v.string()),
      })
    ),
    url: v.string(),
  })
);

/** The card as the open needs it, with the cached answer when it is fresh. */
export const readLinkCheckState = internalQuery({
  args: { cardId: v.string(), userId: v.string() },
  returns: checkStateValidator,
  handler: async (ctx, { cardId: rawCardId, userId }) => {
    const cardId = ctx.db.normalizeId("cards", rawCardId);
    const card = cardId ? await ctx.db.get("cards", cardId) : null;
    const url = sanitizeExternalUrl(card?.url);
    if (
      !(card && url) ||
      card.userId !== userId ||
      card.isDeleted ||
      card.type !== "link"
    ) {
      return { kind: "unavailable" as const };
    }
    if (!card.pageArchive) {
      return { kind: "original" as const, url };
    }
    const row = await readRow(ctx, card._id);
    return {
      kind: "archive" as const,
      archive: {
        capturedAt: card.pageArchive.capturedAt,
        kind: card.pageArchive.kind,
        sourceHost: (
          getSafeUrlHostname(card.pageArchive.sourceUrl) ??
          getSafeUrlHostname(url)
        )?.replace(/^www\./u, ""),
        storageKey: card.pageArchive.storageKey,
      },
      cardId: card._id,
      cached:
        row?.outcome && isFresh(row, Date.now())
          ? { outcome: row.outcome, reason: row.reason }
          : null,
      url,
    };
  },
});

const claimValidator = v.union(
  v.object({ kind: v.literal("claimed") }),
  v.object({ kind: v.literal("busy") }),
  v.object({ kind: v.literal("rate_limited") }),
  v.object({ kind: v.literal("unavailable") }),
  v.object({
    kind: v.literal("cached"),
    outcome: storedOutcomeValidator,
    reason: v.optional(v.string()),
  })
);

/**
 * Claims the check for this card for 5 s, unless another open holds it (a
 * double click, two tabs) or a fresh answer arrived meanwhile. A claim spends
 * one `linkChecks` token; past the limit nothing is claimed.
 */
export const claimLinkCheck = internalMutation({
  args: { cardId: v.id("cards"), userId: v.string() },
  returns: claimValidator,
  handler: async (ctx, { cardId, userId }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card || card.userId !== userId || card.isDeleted) {
      return { kind: "unavailable" as const };
    }
    const now = Date.now();
    const row = await readRow(ctx, cardId);
    if (row?.outcome && isFresh(row, now)) {
      return {
        kind: "cached" as const,
        outcome: row.outcome,
        reason: row.reason,
      };
    }
    if (row?.checkingUntil !== undefined && row.checkingUntil > now) {
      return { kind: "busy" as const };
    }
    const allowed = await rateLimiter.limit(ctx, "linkChecks", {
      key: userId,
      throws: false,
    });
    if (!allowed.ok) {
      return { kind: "rate_limited" as const };
    }
    const checkingUntil = now + LINK_CHECK_CLAIM_MS;
    if (row) {
      await ctx.db.patch("linkChecks", row._id, { checkingUntil });
    } else {
      await ctx.db.insert("linkChecks", { cardId, checkingUntil, userId });
    }
    return { kind: "claimed" as const };
  },
});

/**
 * Keeps an alive or dead answer and lets go of the claim. An unsure answer
 * is never kept, so the next open checks again. An alive answer with the
 * same status as one written within the hour isn't written again.
 */
export const finishLinkCheck = internalMutation({
  args: {
    cardId: v.id("cards"),
    httpStatus: v.optional(v.number()),
    outcome: v.union(
      v.literal("alive"),
      v.literal("dead"),
      v.literal("unsure")
    ),
    reason: v.optional(v.string()),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, httpStatus, outcome, reason, userId }) => {
    const [card, row] = await Promise.all([
      ctx.db.get("cards", cardId),
      readRow(ctx, cardId),
    ]);
    if (!card || card.userId !== userId) {
      // Deleted while it was checked: no row may outlive the card.
      if (row) {
        await ctx.db.delete("linkChecks", row._id);
      }
      return null;
    }
    if (outcome === "unsure") {
      if (row?.outcome) {
        await ctx.db.patch("linkChecks", row._id, {
          checkingUntil: undefined,
        });
      } else if (row) {
        await ctx.db.delete("linkChecks", row._id);
      }
      return null;
    }
    const now = Date.now();
    if (
      row &&
      outcome === "alive" &&
      row.outcome === "alive" &&
      row.httpStatus === httpStatus &&
      row.checkedAt !== undefined &&
      now - row.checkedAt < LINK_CHECK_ALIVE_REWRITE_MS
    ) {
      if (row.checkingUntil !== undefined) {
        await ctx.db.patch("linkChecks", row._id, {
          checkingUntil: undefined,
        });
      }
      return null;
    }
    const fields = {
      checkedAt: now,
      checkingUntil: undefined,
      httpStatus,
      outcome,
      reason,
    };
    if (row) {
      await ctx.db.patch("linkChecks", row._id, fields);
    } else {
      await ctx.db.insert("linkChecks", { cardId, userId, ...fields });
    }
    return null;
  },
});

/** The row a second open waits on. */
export const readLinkCheck = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.null(),
    v.object({
      checkingUntil: v.optional(v.number()),
      fresh: v.boolean(),
      outcome: v.optional(storedOutcomeValidator),
      reason: v.optional(v.string()),
    })
  ),
  handler: async (ctx, { cardId }) => {
    const row = await readRow(ctx, cardId);
    return row
      ? {
          checkingUntil: row.checkingUntil,
          fresh: isFresh(row, Date.now()),
          outcome: row.outcome,
          reason: row.reason,
        }
      : null;
  },
});

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Another open holds the check: wait up to 4 s for its answer, polling the
 * row. It never spends a token or calls the Worker itself.
 */
const waitForCheckInFlight = async (
  ctx: ActionCtx,
  cardId: Id<"cards">
): Promise<{ outcome: "alive" | "dead"; reason?: string } | null> => {
  const deadline = Date.now() + LINK_CHECK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(LINK_CHECK_POLL_INTERVAL_MS);
    const row = await ctx.runQuery(internal.card.linkCheck.readLinkCheck, {
      cardId,
    });
    if (row?.outcome && row.fresh) {
      return { outcome: row.outcome, reason: row.reason };
    }
    if (row?.checkingUntil === undefined || row.checkingUntil <= Date.now()) {
      // The check ended unsure, or its open gave up: nothing to wait for.
      return null;
    }
  }
  return null;
};

const OUTCOMES = new Set<FilesLinkCheckOutcome>(["alive", "dead", "unsure"]);

/** The Worker's answer, or Convex's own reason when it couldn't ask. */
type CheckAnswer = Omit<FilesLinkCheckResult, "reason"> & { reason: string };

const askWorker = async (url: string): Promise<CheckAnswer> => {
  try {
    const answer = await callFilesWorkerJson<FilesLinkCheckResult>({
      op: "check-link",
      params: { url },
      timeoutMs: LINK_CHECK_WORKER_TIMEOUT_MS,
    });
    if (answer.kind === "ok" && OUTCOMES.has(answer.data.outcome)) {
      return answer.data;
    }
    return { outcome: "unsure", reason: "worker_declined" };
  } catch {
    // Unreachable, slow, or a Worker deployed before `check-link`.
    return { outcome: "unsure", reason: "worker_error" };
  }
};

/** A signed URL for the copy, or none when one can't be made. */
const signedArchiveUrl = (key: string): Promise<string | undefined> =>
  getR2Url(key).catch(() => undefined);

export const checkCardLinkFor = async (
  ctx: ActionCtx,
  userId: string,
  cardId: string
): Promise<LinkOpenTarget> => {
  const state = await ctx.runQuery(internal.card.linkCheck.readLinkCheckState, {
    cardId,
    userId,
  });
  if (state.kind === "unavailable") {
    return { target: "unavailable" };
  }
  if (state.kind === "original") {
    return { target: "original", url: state.url };
  }
  const { archive, url } = state;
  const original = (outcome: OpenOutcome, reason?: string): LinkOpenTarget => ({
    target: "original",
    url,
    outcome,
    ...(reason ? { reason } : {}),
  });
  const archived = async (
    outcome: OpenOutcome,
    reason?: string
  ): Promise<LinkOpenTarget> => {
    const archiveUrl = await signedArchiveUrl(archive.storageKey);
    return {
      target: "archive",
      url,
      ...(archiveUrl ? { archiveUrl } : {}),
      capturedAt: archive.capturedAt,
      kind: archive.kind,
      ...(archive.sourceHost ? { sourceHost: archive.sourceHost } : {}),
      outcome,
      ...(reason ? { reason } : {}),
    };
  };
  const cached = (answer: { outcome: "alive" | "dead"; reason?: string }) =>
    answer.outcome === "dead"
      ? archived("cached_dead", answer.reason)
      : original("cached_alive", answer.reason);

  if (state.cached) {
    return await cached(state.cached);
  }
  if (!isFilesWorkerConfigured()) {
    return original("unsure", "unconfigured");
  }
  const claim = await ctx.runMutation(internal.card.linkCheck.claimLinkCheck, {
    cardId: state.cardId,
    userId,
  });
  switch (claim.kind) {
    case "unavailable":
      return { target: "unavailable" };
    case "cached":
      return await cached(claim);
    case "rate_limited":
      return original("unsure", "rate_limited");
    case "busy": {
      const answer = await waitForCheckInFlight(ctx, state.cardId);
      return answer ? await cached(answer) : original("unsure", "in_flight");
    }
    default:
      break;
  }
  let result: CheckAnswer = { outcome: "unsure", reason: "aborted" };
  try {
    result = await askWorker(url);
  } finally {
    await ctx.runMutation(internal.card.linkCheck.finishLinkCheck, {
      cardId: state.cardId,
      outcome: result.outcome,
      userId,
      ...(result.httpStatus === undefined
        ? {}
        : { httpStatus: result.httpStatus }),
      reason: result.reason,
    });
  }
  return result.outcome === "dead"
    ? await archived("dead", result.reason)
    : original(result.outcome, result.reason);
};

/**
 * Where `/open/<cardId>` should go: the original, the archived copy when the
 * original is gone, or nowhere when the card isn't the caller's.
 */
export const checkCardLinkForOpen = action({
  args: { cardId: v.string() },
  returns: linkOpenTargetValidator,
  handler: async (ctx, { cardId }) => {
    const user = await requireSessionUser(ctx);
    return await checkCardLinkFor(ctx, user.teakUserId, cardId);
  },
});

/** The last check's answer when it was dead, for the card dialog's chip. */
export const getLinkCheck = query({
  args: { cardId: v.id("cards") },
  returns: v.union(
    v.null(),
    v.object({ checkedAt: v.number(), outcome: v.literal("dead") })
  ),
  handler: async (ctx, { cardId }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    const card = await ctx.db.get("cards", cardId);
    if (!card || card.userId !== user.teakUserId) {
      return null;
    }
    const row = await readRow(ctx, cardId);
    return row?.outcome === "dead" && row.checkedAt !== undefined
      ? { checkedAt: row.checkedAt, outcome: "dead" as const }
      : null;
  },
});
