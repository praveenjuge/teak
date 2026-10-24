/**
 * Highlights: passages someone marked in a link's article, each with an
 * optional note. Every write keeps `cards.hasHighlights` and
 * `cards.highlightCount` in step in the same mutation, and bumps the card's
 * `updatedAt` so `/v1/cards/changes` reports it. A highlighted link's saved
 * copy and article are frozen (`shared/pageArchive.ts`, `shared/article.ts`).
 */

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";
import { assertAccountNotDeleting } from "../accountDeletion";
import { isCardRunInFlight } from "../card/processingRuns";
import { patchCardWithSearchSync } from "../card/searchSync";
import { highlightValidator } from "../schema";
import { getSessionUser, requireSessionUserId } from "../securitySessions";
import {
  type HighlightSpan,
  spansOverlap,
  unionSpans,
} from "../shared/highlights/anchor";
import {
  cleanHighlightNote,
  type HighlightSource,
  highlightLength,
  MAX_HIGHLIGHT_NOTE_CHARS,
  MAX_HIGHLIGHT_QUOTE_CHARS,
  MAX_HIGHLIGHTS_PER_CARD,
} from "../shared/highlights/constants";
import { RATE_LIMIT_CONFIG, rateLimiter } from "../shared/rateLimits";
import { queueObjectDeletion } from "../storage/r2";
import { queueBackendEvent } from "../telemetry/schedule";

/** The server's messages; the web app shows its own words for each code. */
export const HIGHLIGHT_ERROR_MESSAGES = {
  ARTICLE_CHANGED:
    "This card's saved article changed while you highlighted. Try again.",
  CARD_NOT_FOUND: "Card not found",
  EMPTY_QUOTE: "Highlight some text",
  HIGHLIGHT_LIMIT: `This card has ${MAX_HIGHLIGHTS_PER_CARD} highlights, the most it can hold`,
  INVALID_OFFSETS: "The highlight's offsets don't match its quote",
  NO_ARTICLE: "This card has no saved article to highlight",
  NOT_FOUND: "Highlight not found",
  NOTE_TOO_LONG: "Notes on highlights can be up to 2,000 characters",
  QUOTE_NOT_FOUND: "The quote isn't in this card's saved article",
  QUOTE_TOO_LONG: "Highlights can be up to 5,000 characters",
  RATE_LIMITED: "Too many changes. Try again in a moment.",
} as const;

const fail = (
  code: string,
  message: string,
  extra: Record<string, unknown> = {}
): never => {
  throw new ConvexError({ code, message, ...extra });
};

/** One highlight as the owner reads it. */
export const highlightReturnValidator = v.object({
  ...highlightValidator.fields,
  _id: v.id("highlights"),
  _creationTime: v.number(),
});

/** Every row of a card's highlights; the cap keeps it bounded. */
export const loadCardHighlights = (
  ctx: Pick<QueryCtx, "db">,
  cardId: Id<"cards">
): Promise<Doc<"highlights">[]> =>
  ctx.db
    .query("highlights")
    .withIndex("by_cardId_and_createdAt", (q) => q.eq("cardId", cardId))
    .take(MAX_HIGHLIGHTS_PER_CARD * 2);

const isAnchored = (
  row: Doc<"highlights">
): row is Doc<"highlights"> & { end: number; start: number } =>
  row.unanchored !== true && row.start !== undefined && row.end !== undefined;

/** Article order: by where each starts, the ones not yet found last. */
export const inArticleOrder = (
  rows: Doc<"highlights">[]
): Doc<"highlights">[] =>
  [...rows].sort((a, b) => {
    const aStart = isAnchored(a) ? a.start : Number.POSITIVE_INFINITY;
    const bStart = isAnchored(b) ? b.start : Number.POSITIVE_INFINITY;
    return aStart === bStart ? a.createdAt - b.createdAt : aStart - bStart;
  });

const limitWrites = async (ctx: MutationCtx, userId: string) => {
  const allowed = await rateLimiter.limit(ctx, "highlightWrites", {
    key: userId,
    throws: false,
  });
  if (!allowed.ok) {
    fail("RATE_LIMITED", HIGHLIGHT_ERROR_MESSAGES.RATE_LIMITED, {
      limit: RATE_LIMIT_CONFIG.highlightWrites.capacity,
      retryAt: Date.now() + allowed.retryAfter,
    });
  }
};

const assertNote = (note: string | undefined) => {
  if (note !== undefined && highlightLength(note) > MAX_HIGHLIGHT_NOTE_CHARS) {
    fail("INVALID_INPUT", HIGHLIGHT_ERROR_MESSAGES.NOTE_TOO_LONG);
  }
};

const assertQuote = (quote: string) => {
  if (!quote.trim()) {
    fail("INVALID_INPUT", HIGHLIGHT_ERROR_MESSAGES.EMPTY_QUOTE);
  }
  if (highlightLength(quote) > MAX_HIGHLIGHT_QUOTE_CHARS) {
    fail("INVALID_INPUT", HIGHLIGHT_ERROR_MESSAGES.QUOTE_TOO_LONG);
  }
};

/**
 * Sets the card's highlight count and flag, and moves its `updatedAt`. A
 * card that gains its first highlight drops a page the extension sent that
 * no run is archiving: its copy is frozen now.
 */
const recordCount = async (
  ctx: MutationCtx,
  card: Doc<"cards">,
  count: number,
  now: number
) => {
  const dropSnapshot =
    count > 0 &&
    card.pendingPageSnapshotKey !== undefined &&
    card.pageArchive !== undefined &&
    !(await isCardRunInFlight(ctx, card));
  if (dropSnapshot) {
    await queueObjectDeletion(ctx, card.pendingPageSnapshotKey);
  }
  await patchCardWithSearchSync(ctx, card._id, {
    hasHighlights: count > 0 ? true : undefined,
    highlightCount: count > 0 ? count : undefined,
    ...(dropSnapshot
      ? { pendingPageSnapshotKey: undefined, pendingPageSnapshotAt: undefined }
      : {}),
    updatedAt: now,
  });
};

const ownedCard = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  cardId: Id<"cards">
): Promise<Doc<"cards">> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || card.userId !== userId) {
    return fail("NOT_FOUND", HIGHLIGHT_ERROR_MESSAGES.CARD_NOT_FOUND);
  }
  return card;
};

const ownedHighlight = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  highlightId: Id<"highlights">
): Promise<Doc<"highlights">> => {
  const row = await ctx.db.get("highlights", highlightId);
  if (!row || row.userId !== userId) {
    return fail("NOT_FOUND", HIGHLIGHT_ERROR_MESSAGES.NOT_FOUND);
  }
  return row;
};

/** The ready article of a link card that isn't in Trash, or NO_ARTICLE. */
export const highlightableArticle = (card: Doc<"cards">) => {
  if (
    card.type !== "link" ||
    card.isDeleted === true ||
    card.article?.status !== "ready"
  ) {
    return fail("NO_ARTICLE", HIGHLIGHT_ERROR_MESSAGES.NO_ARTICLE);
  }
  return card.article;
};

export interface SpanInput {
  end: number;
  prefix?: string;
  quote: string;
  start: number;
  suffix?: string;
}

const spanOf = (row: Doc<"highlights"> & { end: number; start: number }) => ({
  start: row.start,
  end: row.end,
  quote: row.quote,
  ...(row.prefix === undefined ? {} : { prefix: row.prefix }),
  ...(row.suffix === undefined ? {} : { suffix: row.suffix }),
});

interface Placement {
  createdAt: number;
  /** The row being placed, when it is one already stored (an anchoring). */
  id?: Id<"highlights">;
  note?: string;
  span: HighlightSpan;
}

/**
 * Places a highlight among the card's anchored ones: alone, or merged with
 * every one it overlaps into one spanning them all. The oldest of a merge
 * keeps its row and its note (the first note, oldest first). Returns the row
 * it ends in, whether a merge happened, and the change in the card's count.
 */
const placeSpan = async (
  ctx: MutationCtx,
  {
    articleKey,
    card,
    capQuote,
    others,
    placement,
    source,
  }: {
    articleKey?: string;
    capQuote: boolean;
    card: Doc<"cards">;
    others: Doc<"highlights">[];
    placement: Placement;
    source: HighlightSource;
  }
): Promise<{ delta: number; id: Id<"highlights">; merged: boolean }> => {
  const now = Date.now();
  const anchored = others.filter(isAnchored);
  const group: typeof anchored = [];
  let union = placement.span;
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of anchored) {
      if (!group.includes(row) && spansOverlap(union, row)) {
        group.push(row);
        union = unionSpans(union, spanOf(row));
        grew = true;
      }
    }
  }
  if (capQuote && highlightLength(union.quote) > MAX_HIGHLIGHT_QUOTE_CHARS) {
    fail("INVALID_INPUT", HIGHLIGHT_ERROR_MESSAGES.QUOTE_TOO_LONG);
  }
  const fields = {
    quote: union.quote,
    prefix: union.prefix,
    suffix: union.suffix,
    start: union.start,
    end: union.end,
    articleKey,
    unanchored: undefined,
    updatedAt: now,
  };
  if (group.length === 0) {
    if (placement.id) {
      await ctx.db.patch("highlights", placement.id, fields);
      return { delta: 0, id: placement.id, merged: false };
    }
    const id = await ctx.db.insert("highlights", {
      userId: card.userId,
      cardId: card._id,
      quote: union.quote,
      ...(union.prefix === undefined ? {} : { prefix: union.prefix }),
      ...(union.suffix === undefined ? {} : { suffix: union.suffix }),
      start: union.start,
      end: union.end,
      ...(articleKey ? { articleKey } : {}),
      ...(placement.note ? { note: placement.note } : {}),
      source,
      createdAt: placement.createdAt,
      updatedAt: now,
    });
    return { delta: 1, id, merged: false };
  }
  const members = [
    ...group.map((row) => ({
      createdAt: row.createdAt,
      id: row._id as Id<"highlights"> | undefined,
      note: row.note,
    })),
    { createdAt: placement.createdAt, id: placement.id, note: placement.note },
  ].sort((a, b) => a.createdAt - b.createdAt);
  const keeper = members.find((member) => member.id !== undefined);
  const keeperId = keeper?.id as Id<"highlights">;
  const note = members.find((member) => cleanHighlightNote(member.note))?.note;
  await ctx.db.patch("highlights", keeperId, { ...fields, note });
  let removed = 0;
  for (const member of members) {
    if (member.id && member.id !== keeperId) {
      await ctx.db.delete("highlights", member.id);
      removed += 1;
    }
  }
  return { delta: -removed, id: keeperId, merged: true };
};

export interface CreateHighlightArgs extends SpanInput {
  /**
   * The article (`cards.article.textKey`) the offsets were measured in. A
   * card whose article was replaced since refuses them: they belong to
   * another text.
   */
  articleKey: string;
  cardId: Id<"cards">;
  note?: string;
}

export interface CreateHighlightResult {
  created: boolean;
  highlight: Doc<"highlights">;
  merged: boolean;
}

/**
 * Highlights `[start, end)` of a card's article (the reader's text) for its
 * owner. The same passage again returns the highlight it already has; one
 * that overlaps others merges with them. At most 200 per card.
 */
export const createHighlightForUser = async (
  ctx: MutationCtx,
  userId: string,
  args: CreateHighlightArgs,
  source: "reader" | "api"
): Promise<CreateHighlightResult> => {
  const card = await ownedCard(ctx, userId, args.cardId);
  const article = highlightableArticle(card);
  if (args.articleKey !== article.textKey) {
    fail("CONFLICT", HIGHLIGHT_ERROR_MESSAGES.ARTICLE_CHANGED);
  }
  await assertAccountNotDeleting(ctx, card.userId);
  assertQuote(args.quote);
  const note = cleanHighlightNote(args.note);
  assertNote(note);
  if (
    !(
      Number.isSafeInteger(args.start) &&
      Number.isSafeInteger(args.end) &&
      args.start >= 0 &&
      args.end > args.start &&
      args.end - args.start === args.quote.length
    )
  ) {
    fail("INVALID_INPUT", HIGHLIGHT_ERROR_MESSAGES.INVALID_OFFSETS);
  }
  await limitWrites(ctx, userId);
  const rows = await loadCardHighlights(ctx, card._id);
  const same = rows.find(
    (row) => isAnchored(row) && row.start === args.start && row.end === args.end
  );
  if (same) {
    return { created: false, highlight: same, merged: false };
  }
  const span: HighlightSpan = {
    start: args.start,
    end: args.end,
    quote: args.quote,
    ...(args.prefix === undefined ? {} : { prefix: args.prefix }),
    ...(args.suffix === undefined ? {} : { suffix: args.suffix }),
  };
  const overlaps = rows.some(
    (row) => isAnchored(row) && spansOverlap(row, span)
  );
  if (!overlaps && rows.length >= MAX_HIGHLIGHTS_PER_CARD) {
    fail("HIGHLIGHT_LIMIT", HIGHLIGHT_ERROR_MESSAGES.HIGHLIGHT_LIMIT, {
      limit: MAX_HIGHLIGHTS_PER_CARD,
    });
  }
  const now = Date.now();
  const placed = await placeSpan(ctx, {
    articleKey: article.textKey,
    capQuote: true,
    card,
    others: rows,
    placement: { createdAt: now, note, span },
    source,
  });
  await recordCount(ctx, card, rows.length + placed.delta, now);
  await queueBackendEvent(ctx, "highlight_created", userId, {
    merged: placed.merged,
    source,
  });
  const highlight = (await ctx.db.get(
    "highlights",
    placed.id
  )) as Doc<"highlights">;
  return { created: !placed.merged, highlight, merged: placed.merged };
};

/** Writes, changes or (null or empty) clears a highlight's note. */
export const updateHighlightNoteForUser = async (
  ctx: MutationCtx,
  userId: string,
  highlightId: Id<"highlights">,
  rawNote: string | null,
  source: "reader" | "api"
): Promise<Doc<"highlights">> => {
  const row = await ownedHighlight(ctx, userId, highlightId);
  await assertAccountNotDeleting(ctx, row.userId);
  const note = cleanHighlightNote(rawNote);
  assertNote(note);
  if (note === row.note) {
    return row;
  }
  await limitWrites(ctx, userId);
  const now = Date.now();
  await ctx.db.patch("highlights", row._id, { note, updatedAt: now });
  const card = await ctx.db.get("cards", row.cardId);
  if (card) {
    await patchCardWithSearchSync(ctx, card._id, { updatedAt: now });
  }
  await queueBackendEvent(ctx, "highlight_note_saved", userId, {
    cleared: note === undefined,
    source,
  });
  return (await ctx.db.get("highlights", row._id)) as Doc<"highlights">;
};

/** Removes a highlight; its card's last one unfreezes the card. */
export const removeHighlightForUser = async (
  ctx: MutationCtx,
  userId: string,
  highlightId: Id<"highlights">,
  source: "reader" | "api"
): Promise<Doc<"highlights">> => {
  const row = await ownedHighlight(ctx, userId, highlightId);
  await assertAccountNotDeleting(ctx, row.userId);
  await limitWrites(ctx, userId);
  await ctx.db.delete("highlights", row._id);
  const card = await ctx.db.get("cards", row.cardId);
  if (card) {
    const remaining = await loadCardHighlights(ctx, card._id);
    await recordCount(ctx, card, remaining.length, Date.now());
  }
  await queueBackendEvent(ctx, "highlight_removed", userId, { source });
  return row;
};

/** A card's highlights for its owner, in article order. */
export const listHighlightsForUser = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  cardId: Id<"cards">
): Promise<Doc<"highlights">[] | null> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || card.userId !== userId) {
    return null;
  }
  if (!card.hasHighlights) {
    return [];
  }
  return inArticleOrder(await loadCardHighlights(ctx, cardId));
};

/**
 * Anchors a card's imported highlights in its article's text: each found one
 * gets its offsets and context (and merges with any it overlaps); the rest
 * stay waiting. Only for the article the anchors were found in.
 */
export const applyAnchors = async (
  ctx: MutationCtx,
  {
    anchors,
    cardId,
    textKey,
  }: {
    anchors: Array<{ highlightId: Id<"highlights"> } & SpanInput>;
    cardId: Id<"cards">;
    textKey: string;
  }
): Promise<number> => {
  const card = await ctx.db.get("cards", cardId);
  if (card?.article?.status !== "ready" || card.article.textKey !== textKey) {
    return 0;
  }
  let rows = await loadCardHighlights(ctx, cardId);
  let placedCount = 0;
  for (const anchor of anchors) {
    const row = rows.find((candidate) => candidate._id === anchor.highlightId);
    if (row?.unanchored !== true) {
      continue;
    }
    await placeSpan(ctx, {
      articleKey: textKey,
      capQuote: false,
      card,
      others: rows.filter((candidate) => candidate._id !== row._id),
      placement: {
        createdAt: row.createdAt,
        id: row._id,
        note: row.note,
        span: {
          start: anchor.start,
          end: anchor.end,
          quote: anchor.quote,
          ...(anchor.prefix === undefined ? {} : { prefix: anchor.prefix }),
          ...(anchor.suffix === undefined ? {} : { suffix: anchor.suffix }),
        },
      },
      source: row.source,
    });
    placedCount += 1;
    rows = await loadCardHighlights(ctx, cardId);
  }
  if (placedCount > 0) {
    await recordCount(ctx, card, rows.length, Date.now());
  }
  return placedCount;
};

/**
 * An import's highlights for a card it just made: unanchored until the
 * card's article is extracted, at most 200, each quote and note within its
 * cap. Returns how many it wrote.
 */
export const insertImportedHighlights = async (
  ctx: MutationCtx,
  card: Pick<Doc<"cards">, "_id" | "userId">,
  highlights: Array<{ note?: string; quote: string }>,
  now = Date.now()
): Promise<number> => {
  const existing = await loadCardHighlights(ctx, card._id);
  const room = MAX_HIGHLIGHTS_PER_CARD - existing.length;
  let written = 0;
  for (const highlight of highlights) {
    if (written >= room) {
      break;
    }
    const quote = highlight.quote.trim();
    const note = cleanHighlightNote(highlight.note);
    if (
      !quote ||
      highlightLength(quote) > MAX_HIGHLIGHT_QUOTE_CHARS ||
      (note !== undefined && highlightLength(note) > MAX_HIGHLIGHT_NOTE_CHARS)
    ) {
      continue;
    }
    await ctx.db.insert("highlights", {
      userId: card.userId,
      cardId: card._id,
      quote,
      ...(note ? { note } : {}),
      unanchored: true,
      source: "import",
      // Imported in their order: one millisecond apart keeps it.
      createdAt: now + written,
      updatedAt: now,
    });
    written += 1;
  }
  if (written > 0) {
    const fresh = await ctx.db.get("cards", card._id);
    if (fresh) {
      await recordCount(ctx, fresh, existing.length + written, now);
    }
    await queueBackendEvent(ctx, "highlight_created", card.userId, {
      count: written,
      merged: false,
      source: "import",
    });
  }
  return written;
};

// The reader's functions, for the signed-in owner.

export const listForCard = query({
  args: { cardId: v.id("cards") },
  returns: v.array(highlightReturnValidator),
  handler: async (ctx, { cardId }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return [];
    }
    return (await listHighlightsForUser(ctx, user.teakUserId, cardId)) ?? [];
  },
});

const createResultValidator = v.object({
  created: v.boolean(),
  highlight: highlightReturnValidator,
  merged: v.boolean(),
});

export const create = mutation({
  args: {
    cardId: v.id("cards"),
    articleKey: v.string(),
    quote: v.string(),
    prefix: v.optional(v.string()),
    suffix: v.optional(v.string()),
    start: v.number(),
    end: v.number(),
    note: v.optional(v.string()),
  },
  returns: createResultValidator,
  handler: async (ctx, args) =>
    createHighlightForUser(
      ctx,
      await requireSessionUserId(ctx),
      args,
      "reader"
    ),
});

export const updateNote = mutation({
  args: {
    highlightId: v.id("highlights"),
    note: v.union(v.string(), v.null()),
  },
  returns: highlightReturnValidator,
  handler: async (ctx, { highlightId, note }) =>
    updateHighlightNoteForUser(
      ctx,
      await requireSessionUserId(ctx),
      highlightId,
      note,
      "reader"
    ),
});

export const remove = mutation({
  args: { highlightId: v.id("highlights") },
  returns: highlightReturnValidator,
  handler: async (ctx, { highlightId }) =>
    removeHighlightForUser(
      ctx,
      await requireSessionUserId(ctx),
      highlightId,
      "reader"
    ),
});
