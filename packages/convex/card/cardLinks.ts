import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from "../_generated/server";
import { accountDeletionOwnsRows } from "../accountDeletion";
import { cardTypeValidator } from "../schema";
import {
  getSessionUser,
  requireTeakUserId,
  type TeakUserId,
} from "../securitySessions";
import {
  MAX_CARD_LINKS,
  mayHaveCardLinks,
  parseCardLinkIds,
} from "../shared/cardLinks";
import { isCardHidden, isHiddenTagList, tagKey } from "../shared/tags";
import { cardDisplayTitle, cardPreviewText } from "./displayTitle";

const DELETE_PAGE_SIZE = 500;
const SUGGESTION_LIMIT = 8;
const SUGGESTION_SCAN_LIMIT = 40;
const BACKLINK_SCAN_LIMIT = 500;
export const BACKLINK_PANEL_LIMIT = 50;
export const API_LINK_LIMIT = 100;
export const TITLE_LOOKUP_LIMIT = 100;

const linkTargetValidator = v.object({
  id: v.string(),
  missing: v.boolean(),
  title: v.union(v.string(), v.null()),
  type: v.union(cardTypeValidator, v.null()),
});

const linkedCardValidator = v.object({
  id: v.id("cards"),
  title: v.string(),
  type: cardTypeValidator,
});

export type CardLinkTarget = typeof linkTargetValidator.type;
export type LinkedCard = typeof linkedCardValidator.type;

type TitleLookup = (rawId: string) => Promise<string | undefined>;

const titleLookup = (
  ctx: Pick<QueryCtx, "db">,
  userId: string
): TitleLookup => {
  const titles = new Map<string, Promise<string | undefined>>();
  const read = async (rawId: string) => {
    const id = ctx.db.normalizeId("cards", rawId);
    const card = id ? await ctx.db.get("cards", id) : null;
    return card && card.userId === userId && !card.isDeleted
      ? cardDisplayTitle(card)
      : undefined;
  };
  return (rawId) => {
    let title = titles.get(rawId);
    if (!title) {
      if (titles.size >= TITLE_LOOKUP_LIMIT) {
        return Promise.resolve(undefined);
      }
      title = read(rawId);
      titles.set(rawId, title);
    }
    return title;
  };
};

const linkedCard = async (
  card: Doc<"cards">,
  lookup: TitleLookup
): Promise<LinkedCard> => {
  const firstLine = (card.content ?? "").trimStart().split(/\r?\n/, 1)[0];
  const titles = new Map<string, string>();
  await Promise.all(
    parseCardLinkIds(firstLine).map(async (id) => {
      const title = await lookup(id);
      if (title !== undefined) {
        titles.set(id, title);
      }
    })
  );
  return {
    id: card._id,
    title: cardDisplayTitle(
      card,
      cardPreviewText(card, (title, id) => titles.get(id) ?? title)
    ),
    type: card.type,
  };
};

const resolveTarget = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  rawId: string,
  lookup: TitleLookup
): Promise<CardLinkTarget> => {
  const id = ctx.db.normalizeId("cards", rawId);
  const card = id ? await ctx.db.get("cards", id) : null;
  if (!card || card.userId !== userId || card.isDeleted) {
    return { id: rawId, missing: true, title: null, type: null };
  }
  return { ...(await linkedCard(card, lookup)), missing: false };
};

export const scheduleCardLinkSync = async (
  ctx: Pick<MutationCtx, "scheduler">,
  cardId: Id<"cards">
) => {
  await ctx.scheduler.runAfter(0, internal["card/cardLinks"].syncCardLinks, {
    cardId,
  });
};

export const cardLinksMayChange = (
  previous: Doc<"cards"> | undefined,
  card: Doc<"cards">
): boolean => {
  if (!previous) {
    return mayHaveCardLinks(card.content);
  }
  if (previous.content === card.content && previous.type === card.type) {
    return false;
  }
  return mayHaveCardLinks(previous.content) || mayHaveCardLinks(card.content);
};

export const scheduleDeletedCardLinkCleanup = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
) => {
  const [outgoing, incoming] = await Promise.all([
    ctx.db
      .query("cardLinks")
      .withIndex("by_fromCardId_and_toCardId", (q) =>
        q.eq("fromCardId", cardId)
      )
      .take(1),
    ctx.db
      .query("cardLinks")
      .withIndex("by_toCardId", (q) => q.eq("toCardId", cardId))
      .take(1),
  ]);
  if (outgoing.length > 0 || incoming.length > 0) {
    await ctx.scheduler.runAfter(
      0,
      internal["card/cardLinks"].deleteCardLinksForCard,
      { cardId }
    );
  }
};

/**
 * Rebuilds a card's outgoing link rows from its current content, so it is
 * idempotent and the last save wins. Only the owner's other cards get rows.
 */
export const syncCardLinks = internalMutation({
  args: { cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, { cardId }) => {
    const [card, existing] = await Promise.all([
      ctx.db.get("cards", cardId),
      ctx.db
        .query("cardLinks")
        .withIndex("by_fromCardId_and_toCardId", (q) =>
          q.eq("fromCardId", cardId)
        )
        .take(MAX_CARD_LINKS * 2),
    ]);
    if (card && (await accountDeletionOwnsRows(ctx, card.userId))) {
      return null;
    }

    const wanted = new Set<Id<"cards">>();
    if (card && card.type === "text") {
      for (const rawId of parseCardLinkIds(card.content)) {
        const id = ctx.db.normalizeId("cards", rawId);
        if (!id || id === cardId || wanted.has(id)) {
          continue;
        }
        const target = await ctx.db.get("cards", id);
        if (target?.userId === card.userId) {
          wanted.add(id);
        }
      }
    }

    const kept = new Set<Id<"cards">>();
    for (const row of existing) {
      if (wanted.has(row.toCardId) && !kept.has(row.toCardId)) {
        kept.add(row.toCardId);
      } else {
        await ctx.db.delete("cardLinks", row._id);
      }
    }
    if (!card) {
      return null;
    }
    const now = Date.now();
    for (const toCardId of wanted) {
      if (!kept.has(toCardId)) {
        await ctx.db.insert("cardLinks", {
          createdAt: now,
          fromCardId: cardId,
          toCardId,
          userId: card.userId,
        });
      }
    }
    return null;
  },
});

export const deleteCardLinksForCard = internalMutation({
  args: { cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, { cardId }) => {
    const outgoing = await ctx.db
      .query("cardLinks")
      .withIndex("by_fromCardId_and_toCardId", (q) =>
        q.eq("fromCardId", cardId)
      )
      .take(DELETE_PAGE_SIZE);
    const incoming = await ctx.db
      .query("cardLinks")
      .withIndex("by_toCardId", (q) => q.eq("toCardId", cardId))
      .take(DELETE_PAGE_SIZE - outgoing.length);
    for (const row of [...outgoing, ...incoming]) {
      await ctx.db.delete("cardLinks", row._id);
    }
    if (outgoing.length + incoming.length >= DELETE_PAGE_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal["card/cardLinks"].deleteCardLinksForCard,
        { cardId }
      );
    }
    return null;
  },
});

export const getCardLinkTargets = query({
  args: { cardIds: v.array(v.string()) },
  returns: v.array(linkTargetValidator),
  handler: async (ctx, { cardIds }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return [];
    }
    const unique = Array.from(new Set(cardIds)).slice(0, MAX_CARD_LINKS);
    const lookup = titleLookup(ctx, user.teakUserId);
    return await Promise.all(
      unique.map((id) => resolveTarget(ctx, user.teakUserId, id, lookup))
    );
  },
});

const HASH_TAG_PREFIX = "#";

/**
 * Cards to offer after `[[`. A hidden card is offered only when the query
 * names a revealing tag, as in library search; trashed cards never are.
 */
export const searchCardLinkSuggestions = query({
  args: {
    excludeCardId: v.optional(v.string()),
    query: v.string(),
  },
  returns: v.array(linkedCardValidator),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return [];
    }
    const userId = user.teakUserId;
    const words = args.query.trim().split(/\s+/).filter(Boolean);
    const tags = words
      .filter((word) => word.startsWith(HASH_TAG_PREFIX))
      .map((word) => tagKey(word.slice(1)));
    const includeHidden = isHiddenTagList(tags);
    const text = words
      .filter((word) => !word.startsWith(HASH_TAG_PREFIX))
      .join(" ")
      .slice(0, 200);

    const candidates = text
      ? await searchSuggestionCards(ctx, userId, text, includeHidden)
      : await ctx.db
          .query("cards")
          .withIndex("by_user_deleted_archived_saved", (q) =>
            q
              .eq("userId", userId)
              .eq("isDeleted", undefined)
              .eq("isArchived", undefined)
          )
          .order("desc")
          .take(SUGGESTION_SCAN_LIMIT);

    const lookup = titleLookup(ctx, userId);
    const results: LinkedCard[] = [];
    for (const card of candidates) {
      if (
        card._id === args.excludeCardId ||
        card.userId !== userId ||
        card.isDeleted ||
        (!includeHidden && isCardHidden(card))
      ) {
        continue;
      }
      results.push(await linkedCard(card, lookup));
    }
    return rankCardLinkSuggestions(results, text).slice(0, SUGGESTION_LIMIT);
  },
});

const normalizedTitle = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase();

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Puts a card whose title is the query first, then titles that start with it
 * as a whole word ("plan" before "plan notes"), then titles that start with
 * it at all ("plan" before "planner"), and leaves the search order otherwise.
 */
export const rankCardLinkSuggestions = <T extends { title: string }>(
  items: T[],
  query: string
): T[] => {
  const wanted = normalizedTitle(query);
  if (!wanted) {
    return items;
  }
  const rank = (title: string) => {
    const normalized = normalizedTitle(title);
    if (normalized === wanted) {
      return 0;
    }
    if (!normalized.startsWith(wanted)) {
      return 3;
    }
    const next = normalized.charAt(wanted.length);
    return WORD_CHARACTER.test(next) ? 2 : 1;
  };
  return items
    .map((item, index) => ({ index, item, rank: rank(item.title) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
};

const searchSuggestionCards = async (
  ctx: QueryCtx,
  userId: string,
  text: string,
  includeHidden: boolean
): Promise<Doc<"cards">[]> => {
  const documents = await ctx.db
    .query("cardSearchDocuments")
    .withSearchIndex("search_searchableText", (q) => {
      const filtered = q
        .search("searchableText", text)
        .eq("userId", userId)
        .eq("isDeleted", undefined);
      return includeHidden ? filtered : filtered.eq("isHidden", undefined);
    })
    .take(SUGGESTION_SCAN_LIMIT);
  const cards = await Promise.all(
    documents.map((document) => ctx.db.get("cards", document.cardId))
  );
  return cards.filter((card): card is Doc<"cards"> => card !== null);
};

export interface CardLinks {
  backlinks: CardLinkTarget[];
  backlinksTruncated: boolean;
  links: CardLinkTarget[];
  linksTruncated: boolean;
}

const loadBacklinks = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  cardId: Id<"cards">,
  limit: number,
  lookup: TitleLookup
): Promise<{ backlinks: LinkedCard[]; truncated: boolean }> => {
  const rows = await ctx.db
    .query("cardLinks")
    .withIndex("by_toCardId", (q) => q.eq("toCardId", cardId))
    .order("desc")
    .take(BACKLINK_SCAN_LIMIT);
  const sources = await Promise.all(
    rows
      .filter((row) => row.userId === userId)
      .map((row) => ctx.db.get("cards", row.fromCardId))
  );
  const visible = sources
    .filter(
      (card): card is Doc<"cards"> =>
        card !== null &&
        card.userId === userId &&
        !card.isDeleted &&
        !isCardHidden(card)
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    backlinks: await Promise.all(
      visible.slice(0, limit).map((card) => linkedCard(card, lookup))
    ),
    truncated: visible.length > limit || rows.length === BACKLINK_SCAN_LIMIT,
  };
};

export const getCardLinksHandler = async (
  ctx: Pick<QueryCtx, "db">,
  card: Doc<"cards">,
  limit = API_LINK_LIMIT
): Promise<CardLinks> => {
  const ids = card.type === "text" ? parseCardLinkIds(card.content) : [];
  const lookup = titleLookup(ctx, card.userId);
  const [links, backlinks] = await Promise.all([
    Promise.all(
      ids
        .slice(0, limit)
        .map((id) => resolveTarget(ctx, card.userId, id, lookup))
    ),
    loadBacklinks(ctx, card.userId, card._id, limit, lookup),
  ]);
  return {
    backlinks: backlinks.backlinks.map((card) => ({
      ...card,
      missing: false,
    })),
    backlinksTruncated: backlinks.truncated,
    links,
    linksTruncated: ids.length > limit,
  };
};

export const getCardBacklinks = query({
  args: { cardId: v.id("cards") },
  returns: v.object({
    backlinks: v.array(linkedCardValidator),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    const card = user ? await ctx.db.get("cards", args.cardId) : null;
    if (!(user && card) || card.userId !== user.teakUserId) {
      return { backlinks: [], hasMore: false };
    }
    const { backlinks, truncated } = await loadBacklinks(
      ctx,
      user.teakUserId,
      card._id,
      BACKLINK_PANEL_LIMIT,
      titleLookup(ctx, user.teakUserId)
    );
    return { backlinks, hasMore: truncated };
  },
});

export const getCardLinksForUserHandler = async (
  ctx: Pick<QueryCtx, "db">,
  userId: TeakUserId,
  cardId: Id<"cards">
): Promise<CardLinks | null> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || card.userId !== userId) {
    return null;
  }
  return await getCardLinksHandler(ctx, card);
};

export const cardLinksValidator = v.object({
  backlinks: v.array(linkTargetValidator),
  backlinksTruncated: v.boolean(),
  links: v.array(linkTargetValidator),
  linksTruncated: v.boolean(),
});

export const getCardLinksForUser = internalQuery({
  args: { cardId: v.id("cards"), userId: v.string() },
  returns: v.union(v.null(), cardLinksValidator),
  handler: async (ctx, args) =>
    await getCardLinksForUserHandler(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      args.cardId
    ),
});
