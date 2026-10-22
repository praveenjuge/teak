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
import { scanInBatches } from "./scanInBatches";
import { buildCardSearchText } from "./searchDocumentHelpers";

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
    text: string;
  }
): Promise<Doc<"cards">[]> => {
  const words = tokenizeSearchInput(text).map((word) => word.toLowerCase());
  const minScore = similarity.kind === "mood" ? SEMANTIC_MIN_SCORE : 0;
  const anchorId = similarity.kind === "like" ? similarity.cardId : null;
  const seen = new Set<Id<"cards">>();
  const candidates = ranking.filter((match) => {
    if (
      match.score < minScore ||
      match.cardId === anchorId ||
      seen.has(match.cardId)
    ) {
      return false;
    }
    seen.add(match.cardId);
    return true;
  });
  const cards: Doc<"cards">[] = [];
  await scanInBatches(
    candidates,
    () => SIMILAR_CARDS_LIMIT - cards.length,
    (match) => ctx.db.get("cards", match.cardId),
    (_match, card) => {
      if (!(card && card.userId === userId && keep(card))) {
        return;
      }
      if (words.length > 0) {
        const text = buildCardSearchText(card).toLowerCase();
        if (!words.every((word) => text.includes(word))) {
          return;
        }
      }
      cards.push(card);
    }
  );
  return cards;
};

const ANCHOR_TITLE_MAX = 300;

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
