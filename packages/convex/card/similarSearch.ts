import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type QueryCtx, query } from "../_generated/server";
import type { SemanticRanking } from "../search/semanticCache";
import { getSessionUser } from "../securitySessions";
import type { SearchSimilarity } from "../shared/search/qualifiers";
import {
  SEMANTIC_MIN_SCORE,
  SIMILAR_CARDS_LIMIT,
} from "../shared/search/semantic";
import { tokenizeSearchInput } from "../shared/search/tokenization";
import { buildCardSearchText } from "./searchDocumentHelpers";

/**
 * `like:` and `mood:` searches list meaning matches only, from the cached
 * ranking (search/semanticCache.ts): the other qualifiers and the view filter
 * them, and the search's words must all appear in a card (they narrow, they
 * don't add). The caller sorts.
 */

/** Whether a `like:` card is the user's and outside Trash. */
export const isSimilarAnchorAvailable = async (
  ctx: QueryCtx,
  userId: string,
  cardId: string
): Promise<boolean> => {
  const id = ctx.db.normalizeId("cards", cardId);
  const card = id ? await ctx.db.get("cards", id) : null;
  return card?.userId === userId && card.isDeleted !== true;
};

export const loadSimilarCards = async (
  ctx: QueryCtx,
  {
    userId,
    similarity,
    ranking,
    keep,
    text,
  }: {
    userId: string;
    similarity: SearchSimilarity;
    ranking: SemanticRanking;
    keep: (card: Doc<"cards">) => boolean;
    /** The search's words, which a card's text must all contain. */
    text: string;
  }
): Promise<Doc<"cards">[]> => {
  // Split as the keyword search splits, so `chair,` and `(chair)` are `chair`.
  const words = tokenizeSearchInput(text).map((word) => word.toLowerCase());
  // A card's neighbors are the answer, however close; a mood needs a real
  // match, as free text does.
  const minScore = similarity.kind === "mood" ? SEMANTIC_MIN_SCORE : 0;
  const anchorId = similarity.kind === "like" ? similarity.cardId : null;
  const cards: Doc<"cards">[] = [];
  const seen = new Set<Id<"cards">>();
  for (const match of ranking) {
    if (cards.length >= SIMILAR_CARDS_LIMIT) {
      break;
    }
    if (
      match.score < minScore ||
      match.cardId === anchorId ||
      seen.has(match.cardId)
    ) {
      continue;
    }
    seen.add(match.cardId);
    const card = await ctx.db.get("cards", match.cardId);
    if (!(card && card.userId === userId && keep(card))) {
      continue;
    }
    if (words.length > 0) {
      const text = buildCardSearchText(card).toLowerCase();
      if (!words.every((word) => text.includes(word))) {
        continue;
      }
    }
    cards.push(card);
  }
  return cards;
};

const ANCHOR_TITLE_MAX = 300;

/** A card's display title for the `like:` chip. */
const anchorTitle = (card: Doc<"cards">): string => {
  const title =
    (card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview.title
      : undefined) ||
    card.metadataTitle ||
    card.fileMetadata?.fileName ||
    card.content?.trim().split("\n", 1)[0] ||
    card.url ||
    "Untitled card";
  return title.slice(0, ANCHOR_TITLE_MAX);
};

/**
 * The `like:` chip's label: the card's title while it can anchor a search,
 * `pending` before its first vector, and `unavailable` for a card that is
 * gone, in Trash or someone else's (never their title).
 */
export const similarAnchorSummary = query({
  args: { cardId: v.string() },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("pending"),
      v.literal("unavailable")
    ),
    title: v.optional(v.string()),
  }),
  handler: async (ctx, { cardId }) => {
    const user = await getSessionUser(ctx);
    const id = ctx.db.normalizeId("cards", cardId);
    const card = id ? await ctx.db.get("cards", id) : null;
    if (!(user && card && card.userId === user.teakUserId) || card.isDeleted) {
      return { status: "unavailable" as const };
    }
    const row = await ctx.db
      .query("cardEmbeddings")
      .withIndex("by_cardId", (q) => q.eq("cardId", card._id))
      .unique();
    return {
      status: row?.hash === undefined ? ("pending" as const) : ("ok" as const),
      title: anchorTitle(card),
    };
  },
});
