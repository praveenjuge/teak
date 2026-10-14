import {
  FILES_EXTRACTED_TEXT_MAX_CHARACTERS,
  FILES_PDF_TEXT_MAX_PAGES,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  env,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { readBodyWithLimit } from "../linkMetadata/ssrf";
import { putObjectViaFilesWorker } from "../storage/filesWorkerClient";
import { getR2Url } from "../storage/fileUrls";
import { buildR2UserPrefix, deleteObject } from "../storage/r2";
import { patchCardWithSearchSync } from "./searchDocumentHelpers";

// Text Teak extracts from a card's file (PDF, Word, PowerPoint, text and
// code). The full text is an R2 object named by its SHA-256, so a rerun of
// the same extraction writes nothing new; its first 32 KiB is a
// cardTextContents row, appended to the card's search text.

/** Bytes of extracted text that search covers. */
export const SEARCH_PREFIX_MAX_BYTES = 32 * 1024;
/** UTF-8 bytes of the largest stored text (4 bytes a character at most). */
const MAX_TEXT_BYTES = FILES_EXTRACTED_TEXT_MAX_CHARACTERS * 4;

const encoder = new TextEncoder();

/** The start of `text` that fits in `maxBytes` of UTF-8, whole characters. */
export const searchPrefix = (
  text: string,
  maxBytes = SEARCH_PREFIX_MAX_BYTES
): string => {
  if (encoder.encode(text).byteLength <= maxBytes) {
    return text;
  }
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const size = encoder.encode(character).byteLength;
    if (bytes + size > maxBytes) {
      break;
    }
    bytes += size;
    end += character.length;
  }
  return text.slice(0, end);
};

/**
 * Whether the Files Worker stopped before the end of the document: it read
 * its whole character budget, or the PDF has pages past the ones it reads.
 */
export const isExtractedTextTruncated = (
  text: string,
  pageCount?: number
): boolean =>
  text.length >= FILES_EXTRACTED_TEXT_MAX_CHARACTERS ||
  // The text and archive modes count their budget in UTF-8 bytes.
  encoder.encode(text).byteLength >= FILES_EXTRACTED_TEXT_MAX_CHARACTERS ||
  (pageCount ?? 0) > FILES_PDF_TEXT_MAX_PAGES;

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

export const documentTextKey = (
  card: Pick<Doc<"cards">, "_id" | "userId">,
  digest: string
): string => {
  if (!(/^[a-f0-9]{64}$/.test(digest) && /^[a-z0-9]+$/i.test(card._id))) {
    throw new Error("document_text_invalid_key");
  }
  return `${buildR2UserPrefix(card.userId)}/${card._id}/document-text/${digest}.txt`;
};

const digestOfKey = (key: string): string | null =>
  /\/document-text\/([a-f0-9]{64})\.txt$/.exec(key)?.[1] ?? null;

/**
 * Stores a card's extracted text: the full text in R2, then its searchable
 * prefix. Empty text stores nothing, so a scan without a text layer, or a
 * failed extraction, never replaces text the card already has.
 */
export const storeDocumentText = async (
  ctx: {
    runMutation: (reference: any, args: any) => Promise<unknown>;
  },
  card: Pick<Doc<"cards">, "_id" | "documentTextKey" | "userId">,
  extracted: { pageCount?: number; text: string }
): Promise<{ charCount: number; stored: boolean }> => {
  const text = extracted.text.trim();
  if (!text) {
    return { charCount: 0, stored: false };
  }
  const key = documentTextKey(card, await sha256Hex(text));
  const charCount = Array.from(text).length;
  if (card.documentTextKey !== key) {
    await putObjectViaFilesWorker({
      body: encoder.encode(text),
      contentType: "text/plain; charset=utf-8",
      key,
      signal: AbortSignal.timeout(30_000),
    });
  }
  await ctx.runMutation(
    (internal as any)["card/documentText"].saveDocumentText,
    {
      cardId: card._id,
      key,
      text: searchPrefix(text),
      charCount,
      truncated: isExtractedTextTruncated(text, extracted.pageCount),
    }
  );
  return { charCount, stored: true };
};

export const saveDocumentTextHandler = async (
  ctx: MutationCtx,
  args: {
    cardId: Id<"cards">;
    charCount: number;
    key: string;
    text: string;
    truncated: boolean;
  }
): Promise<boolean> => {
  const card = await ctx.db.get("cards", args.cardId);
  // The card went away (or its account is being deleted) while the text was
  // extracted: nothing will ever list this object, so remove it now.
  if (!card || (await getAccountDeletionState(ctx, card.userId))) {
    await deleteObject(ctx, args.key);
    return false;
  }
  if (args.key !== documentTextKey(card, digestOfKey(args.key) ?? "")) {
    throw new Error("document_text_invalid_key");
  }
  const existing = await ctx.db
    .query("cardTextContents")
    .withIndex("by_cardId", (query) => query.eq("cardId", card._id))
    .unique();
  const row = {
    cardId: card._id,
    userId: card.userId,
    kind: "document" as const,
    text: searchPrefix(args.text),
    sourceKey: args.key,
    charCount: args.charCount,
    truncated: args.truncated,
  };
  if (existing) {
    if (
      existing.sourceKey !== row.sourceKey ||
      existing.text !== row.text ||
      existing.charCount !== row.charCount ||
      existing.truncated !== row.truncated
    ) {
      await ctx.db.replace("cardTextContents", existing._id, row);
    }
  } else {
    await ctx.db.insert("cardTextContents", row);
  }
  if (
    card.documentTextKey === args.key &&
    card.hasExtractedText &&
    card.extractedTextCharCount === args.charCount
  ) {
    return true;
  }
  if (card.documentTextKey && card.documentTextKey !== args.key) {
    await deleteObject(ctx, card.documentTextKey);
  }
  return await patchCardWithSearchSync(ctx, card._id, {
    documentTextKey: args.key,
    hasExtractedText: true,
    extractedTextCharCount: args.charCount,
  });
};

export const saveDocumentText = internalMutation({
  args: {
    cardId: v.id("cards"),
    key: v.string(),
    text: v.string(),
    charCount: v.number(),
    truncated: v.boolean(),
  },
  returns: v.boolean(),
  handler: saveDocumentTextHandler,
});

const cardTextSourceValidator = v.union(
  v.null(),
  v.object({
    cardId: v.id("cards"),
    kind: v.union(
      v.literal("document"),
      v.literal("transcript"),
      v.literal("content")
    ),
    text: v.string(),
    sourceKey: v.optional(v.string()),
    charCount: v.number(),
    truncated: v.boolean(),
  })
);

/**
 * Where a card's text lives, for the owner only: extracted document text
 * (its prefix here, the rest in R2), else its transcript, else the written
 * content of a text or quote card. Null when the card has none.
 */
export const getCardTextSource = internalQuery({
  args: { cardId: v.id("cards"), userId: v.string() },
  returns: cardTextSourceValidator,
  handler: async (ctx, { cardId, userId }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card || card.userId !== userId) {
      return null;
    }
    if (card.hasExtractedText) {
      const row = await ctx.db
        .query("cardTextContents")
        .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
        .unique();
      if (row) {
        return {
          cardId,
          kind: "document" as const,
          text: row.text,
          sourceKey: row.sourceKey,
          charCount: row.charCount,
          truncated: row.truncated,
        };
      }
    }
    if (card.aiTranscript?.trim()) {
      return {
        cardId,
        kind: "transcript" as const,
        text: card.aiTranscript,
        charCount: Array.from(card.aiTranscript).length,
        truncated: false,
      };
    }
    if ((card.type === "text" || card.type === "quote") && card.content) {
      return {
        cardId,
        kind: "content" as const,
        text: card.content,
        charCount: Array.from(card.content).length,
        truncated: false,
      };
    }
    return null;
  },
});

const isLocalHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1";

/**
 * Reads a card's full extracted text from R2 through the signed read
 * endpoint and checks it against the digest its key is named by.
 */
export const readDocumentText = async (key: string): Promise<string> => {
  const digest = digestOfKey(key);
  if (!digest) {
    throw new Error("document_text_invalid_key");
  }
  const signedUrl = new URL(await getR2Url(key));
  const base = new URL(env.FILES_BASE ?? "");
  if (
    !(
      base.protocol === "https:" ||
      (base.protocol === "http:" && isLocalHost(base.hostname))
    ) ||
    base.username ||
    base.password ||
    signedUrl.origin !== base.origin ||
    signedUrl.pathname !== `/${key}`
  ) {
    throw new Error("document_text_invalid_read_origin");
  }
  const response = await fetch(signedUrl.toString(), {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`document_text_read_failed:${response.status}`);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    await readBodyWithLimit(response, MAX_TEXT_BYTES)
  );
  if ((await sha256Hex(text)) !== digest) {
    throw new Error("document_text_hash_mismatch");
  }
  return text;
};
