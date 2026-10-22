import { FILES_EXTRACTED_TEXT_MAX_CHARACTERS } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  type ActionCtx,
  env,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { readBodyWithLimit } from "../linkMetadata/ssrf";
import { codePointLength } from "../shared/utils/codePoints";
import { putObjectViaFilesWorker } from "../storage/filesWorkerClient";
import { getR2Url } from "../storage/fileUrls";
import { buildR2UserPrefix, queueObjectDeletion } from "../storage/r2";
import { sha256Hex } from "../storage/r2Keys";
import {
  documentTextObjectKey,
  isExtractedTextTruncated,
  searchPrefix,
} from "./documentTextFormat";
import { patchCardWithSearchSync } from "./searchSync";
import { getDocumentTextRow, readCardTranscript } from "./textContents";

export {
  isExtractedTextTruncated,
  SEARCH_PREFIX_MAX_BYTES,
  searchPrefix,
} from "./documentTextFormat";

const MAX_TEXT_BYTES = FILES_EXTRACTED_TEXT_MAX_CHARACTERS * 4;

const encoder = new TextEncoder();

export const documentTextKey = (
  card: Pick<Doc<"cards">, "_id" | "userId">,
  digest: string
): string =>
  documentTextObjectKey(buildR2UserPrefix(card.userId), card._id, digest);

const digestOfKey = (key: string): string | null =>
  /\/document-text\/([a-f0-9]{64})\.txt$/.exec(key)?.[1] ?? null;

export const storeDocumentText = async (
  ctx: Pick<ActionCtx, "runMutation">,
  card: Pick<Doc<"cards">, "_id" | "documentTextKey" | "userId">,
  extracted: { pageCount?: number; text: string }
): Promise<{ charCount: number; stored: boolean }> => {
  const text = extracted.text.trim();
  if (!text) {
    return { charCount: 0, stored: false };
  }
  const key = documentTextKey(card, await sha256Hex(text));
  const charCount = codePointLength(text);
  if (card.documentTextKey !== key) {
    await putObjectViaFilesWorker({
      body: encoder.encode(text),
      contentType: "text/plain; charset=utf-8",
      key,
      signal: AbortSignal.timeout(30_000),
    });
  }
  await ctx.runMutation(internal["card/documentText"].saveDocumentText, {
    cardId: card._id,
    key,
    text: searchPrefix(text),
    charCount,
    truncated: isExtractedTextTruncated(text, extracted.pageCount),
  });
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
  if (!card || (await getAccountDeletionState(ctx, card.userId))) {
    await queueObjectDeletion(ctx, args.key);
    return false;
  }
  if (args.key !== documentTextKey(card, digestOfKey(args.key) ?? "")) {
    throw new Error("document_text_invalid_key");
  }
  const existing = await getDocumentTextRow(ctx, card._id);
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
    await queueObjectDeletion(ctx, card.documentTextKey);
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

export const getCardTextSource = internalQuery({
  args: { cardId: v.id("cards"), userId: v.string() },
  returns: cardTextSourceValidator,
  handler: async (ctx, { cardId, userId }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card || card.userId !== userId) {
      return null;
    }
    if (card.hasExtractedText) {
      const row = await getDocumentTextRow(ctx, cardId);
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
    const transcript = await readCardTranscript(ctx, card);
    if (transcript?.trim()) {
      return {
        cardId,
        kind: "transcript" as const,
        text: transcript,
        charCount: card.aiTranscriptCharCount ?? codePointLength(transcript),
        truncated: false,
      };
    }
    if ((card.type === "text" || card.type === "quote") && card.content) {
      return {
        cardId,
        kind: "content" as const,
        text: card.content,
        charCount: codePointLength(card.content),
        truncated: false,
      };
    }
    return null;
  },
});

const isLocalHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1";

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
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: false,
  }).decode(await readBodyWithLimit(response, MAX_TEXT_BYTES));
  if ((await sha256Hex(text)) !== digest) {
    throw new Error("document_text_hash_mismatch");
  }
  return text;
};
