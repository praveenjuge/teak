import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  type ActionCtx,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import {
  codePointLength,
  truncateCodePoints,
} from "../shared/utils/codePoints";
import { SEARCH_PREFIX_MAX_BYTES } from "./documentTextFormat";

// A document row plus a transcript's parts. A transcript is at most
// FILES_TRANSCRIPT_MAX_BYTES (512 KB), so 16 parts; 32 is the old 1 MB card.
const MAX_TRANSCRIPT_PARTS = 32;
const MAX_TEXT_ROWS_PER_CARD = MAX_TRANSCRIPT_PARTS + 1;
const TRANSCRIPT_PREVIEW_CHARS = 280;

type TranscriptCard = Pick<
  Doc<"cards">,
  "_id" | "aiTranscript" | "aiTranscriptCharCount"
>;

const utf8Length = (codePoint: number): number => {
  if (codePoint < 0x80) {
    return 1;
  }
  if (codePoint < 0x8_00) {
    return 2;
  }
  return codePoint < 0x1_00_00 ? 3 : 4;
};

/** `text` in order, cut into parts of at most `maxBytes` UTF-8 bytes. */
export const splitTextByBytes = (
  text: string,
  maxBytes = SEARCH_PREFIX_MAX_BYTES
): string[] => {
  const parts: string[] = [];
  let start = 0;
  let index = 0;
  let bytes = 0;
  for (const character of text) {
    const size = utf8Length(character.codePointAt(0) ?? 0);
    if (bytes + size > maxBytes) {
      parts.push(text.slice(start, index));
      start = index;
      bytes = 0;
    }
    bytes += size;
    index += character.length;
  }
  if (start < text.length) {
    parts.push(text.slice(start));
  }
  return parts;
};

export const transcriptPreview = (text: string): string =>
  truncateCodePoints(text.trim(), TRANSCRIPT_PREVIEW_CHARS);

const cardTextRows = (ctx: Pick<QueryCtx, "db">, cardId: Id<"cards">) =>
  ctx.db
    .query("cardTextContents")
    .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
    .take(MAX_TEXT_ROWS_PER_CARD);

export const getDocumentTextRow = async (
  ctx: Pick<QueryCtx, "db">,
  cardId: Id<"cards">
): Promise<Doc<"cardTextContents"> | null> =>
  (await cardTextRows(ctx, cardId)).find((row) => row.kind === "document") ??
  null;

const transcriptRows = async (
  ctx: Pick<QueryCtx, "db">,
  cardId: Id<"cards">
): Promise<Doc<"cardTextContents">[]> =>
  (await cardTextRows(ctx, cardId))
    .filter((row) => row.kind === "transcript")
    .sort((left, right) => (left.part ?? 0) - (right.part ?? 0));

/**
 * The card's transcript: from `cardTextContents`, or from the card while
 * `migration/moveCardTranscripts` hasn't reached it. `maxParts` reads only
 * the start, for callers that need a few thousand characters.
 */
export const readCardTranscript = async (
  ctx: Pick<QueryCtx, "db">,
  card: TranscriptCard,
  options: { maxParts?: number } = {}
): Promise<string | undefined> => {
  if (card.aiTranscriptCharCount === undefined) {
    return card.aiTranscript;
  }
  const rows = await transcriptRows(ctx, card._id);
  if (rows.length === 0) {
    return card.aiTranscript;
  }
  return rows
    .slice(0, options.maxParts ?? rows.length)
    .map((row) => row.text)
    .join("");
};

const deleteCardTranscriptRows = async (
  ctx: Pick<MutationCtx, "db">,
  card: Pick<Doc<"cards">, "_id" | "aiTranscriptCharCount">
): Promise<void> => {
  if (card.aiTranscriptCharCount === undefined) {
    return;
  }
  for (const row of await transcriptRows(ctx, card._id)) {
    await ctx.db.delete("cardTextContents", row._id);
  }
};

/** Every text row of the card, for card and account deletion. */
export const deleteCardTextRows = async (
  ctx: Pick<MutationCtx, "db">,
  cardId: Id<"cards">
): Promise<void> => {
  for (const row of await cardTextRows(ctx, cardId)) {
    await ctx.db.delete("cardTextContents", row._id);
  }
};

/** The card fields that say a card has no transcript. */
export const CLEARED_TRANSCRIPT = {
  aiTranscript: undefined,
  aiTranscriptCharCount: undefined,
  aiTranscriptPreview: undefined,
} as const;

/** Deletes the card's transcript rows; returns the card fields to write. */
export const clearCardTranscript = async (
  ctx: Pick<MutationCtx, "db">,
  card: Pick<Doc<"cards">, "_id" | "aiTranscriptCharCount">
): Promise<typeof CLEARED_TRANSCRIPT> => {
  await deleteCardTranscriptRows(ctx, card);
  return CLEARED_TRANSCRIPT;
};

/**
 * Replaces the card's transcript rows with `transcript` and returns the card
 * fields to write with it; an empty transcript clears it. The card itself
 * keeps only the length and a preview.
 */
export const storeCardTranscript = async (
  ctx: Pick<MutationCtx, "db">,
  card: Pick<Doc<"cards">, "_id" | "aiTranscriptCharCount" | "userId">,
  transcript: string
): Promise<
  Pick<
    Doc<"cards">,
    "aiTranscript" | "aiTranscriptCharCount" | "aiTranscriptPreview"
  >
> => {
  await deleteCardTranscriptRows(ctx, card);
  if (!transcript) {
    return CLEARED_TRANSCRIPT;
  }
  const allParts = splitTextByBytes(transcript);
  const parts = allParts.slice(0, MAX_TRANSCRIPT_PARTS);
  const truncated = parts.length < allParts.length;
  const stored = truncated ? parts.join("") : transcript;
  const charCount = codePointLength(stored);
  for (const [part, text] of parts.entries()) {
    await ctx.db.insert("cardTextContents", {
      cardId: card._id,
      userId: card.userId,
      kind: "transcript",
      text,
      part,
      charCount,
      truncated,
    });
  }
  return {
    aiTranscript: undefined,
    aiTranscriptCharCount: charCount,
    aiTranscriptPreview: transcriptPreview(stored),
  };
};

const MAX_TRANSCRIPT_CARDS_PER_READ = 100;
// A read stays well under a query's 16 MB, counting 4 bytes a character.
const MAX_TRANSCRIPT_BYTES_PER_READ = 8 * 1024 * 1024;

export const getCardTranscriptsForUser = internalQuery({
  args: { userId: v.string(), cardIds: v.array(v.id("cards")) },
  returns: v.array(v.object({ cardId: v.id("cards"), transcript: v.string() })),
  handler: async (ctx, { userId, cardIds }) => {
    const transcripts: { cardId: Id<"cards">; transcript: string }[] = [];
    for (const cardId of cardIds.slice(0, MAX_TRANSCRIPT_CARDS_PER_READ)) {
      const card = await ctx.db.get("cards", cardId);
      if (!card || card.userId !== userId) {
        continue;
      }
      const transcript = await readCardTranscript(ctx, card);
      if (transcript !== undefined) {
        transcripts.push({ cardId, transcript });
      }
    }
    return transcripts;
  },
});

/**
 * List cards with their transcripts put back, for public API responses that
 * promise them. Lists leave transcripts out; this reads them in batches small
 * enough for one query each.
 */
export const withTranscripts = async <
  T extends {
    _id: Id<"cards">;
    aiTranscript?: string;
    aiTranscriptCharCount?: number;
  },
>(
  ctx: Pick<ActionCtx, "runQuery">,
  userId: string,
  cards: T[]
): Promise<T[]> => {
  const batches: Id<"cards">[][] = [];
  let batch: Id<"cards">[] = [];
  let batchBytes = 0;
  for (const card of cards) {
    if (
      card.aiTranscript !== undefined ||
      card.aiTranscriptCharCount === undefined
    ) {
      continue;
    }
    const bytes = card.aiTranscriptCharCount * 4;
    if (
      batch.length > 0 &&
      (batch.length === MAX_TRANSCRIPT_CARDS_PER_READ ||
        batchBytes + bytes > MAX_TRANSCRIPT_BYTES_PER_READ)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(card._id);
    batchBytes += bytes;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  if (batches.length === 0) {
    return cards;
  }
  const transcripts = new Map<Id<"cards">, string>();
  for (const cardIds of batches) {
    const rows = await ctx.runQuery(
      internal.card.textContents.getCardTranscriptsForUser,
      { userId, cardIds }
    );
    for (const row of rows) {
      transcripts.set(row.cardId, row.transcript);
    }
  }
  return cards.map((card) => {
    const transcript = transcripts.get(card._id);
    return transcript === undefined
      ? card
      : { ...card, aiTranscript: transcript };
  });
};
