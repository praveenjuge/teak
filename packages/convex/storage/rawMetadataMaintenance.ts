import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getAccountDeletionState } from "../accountDeletion";
import { deleteObject } from "./r2";
import type { Id } from "../_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import {
  copyAndVerifyRaw,
  hashRawMetadata,
  rawArchivalConfigured,
  rawMetadataKey,
  serializeArchivableRaw,
  serializeRawMetadata,
} from "./rawMetadata";

const functions = () => internal.storage.rawMetadataMaintenance;
const kindValidator = v.union(
  v.literal("linkPreview"),
  v.literal("linkCategory")
);

export const getRawCard = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.any(),
  handler: (ctx, { cardId }) => ctx.db.get("cards", cardId),
});

export const commitArchive = internalMutation({
  args: {
    cardId: v.id("cards"),
    kind: kindValidator,
    expectedJson: v.string(),
    key: v.string(),
    digest: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { cardId, kind, expectedJson, key, digest }) => {
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      // The card vanished (for example account deletion already removed
      // it) after the archive copy was made; the copy is unreferenced, so
      // remove it rather than leak it.
      try {
        await deleteObject(ctx, key);
      } catch (error) {
        console.error(
          `[rawMetadataMaintenance] Failed to delete orphaned archive ${key}:`,
          error
        );
      }
      return false;
    }
    if (await getAccountDeletionState(ctx, card.userId)) {
      // Account deletion owns this card's teardown; patching here would
      // race its batches with OCC conflicts. The copied object is not yet
      // referenced by the card, so remove it rather than leak it.
      if (card.metadata?.[kind]?.rawStorageKey !== key) {
        await deleteObject(ctx, key);
      }
      return false;
    }
    const part = card?.metadata?.[kind];
    if (
      !(card && part) ||
      key !== rawMetadataKey(card, kind, digest) ||
      (await hashRawMetadata(expectedJson)) !== digest
    ) {
      return false;
    }
    if (part.raw === undefined) {
      return part.rawStorageKey === key && part.rawSha256 === digest;
    }
    if (serializeRawMetadata(part.raw) !== expectedJson) {
      return false;
    }
    const archived = {
      ...part,
      raw: undefined,
      rawStorageKey: key,
      rawSha256: digest,
    };
    if (kind === "linkCategory") {
      const raw = part.raw as {
        structured?: unknown;
        structuredMeta?: { fetchedAt?: unknown };
      };
      Object.assign(archived, {
        rawHasStructured: Boolean(raw?.structured),
        rawStructuredFetchedAt:
          typeof raw?.structuredMeta?.fetchedAt === "number"
            ? raw.structuredMeta.fetchedAt
            : undefined,
      });
    }
    // No search sync or updatedAt churn: customer-visible card fields are identical.
    await ctx.db.patch("cards", cardId, {
      metadata: { ...card.metadata, [kind]: archived },
    });
    return true;
  },
});

export const archiveCardHandler = async (
  ctx: ActionCtx,
  { cardId, attempt = 0 }: { cardId: Id<"cards">; attempt?: number }
): Promise<{ archived: number; skipped: number }> => {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > 2) {
    throw new Error("invalid_archive_attempt");
  }
  let archived = 0;
  let skipped = 0;
  if (!rawArchivalConfigured()) {
    return { archived, skipped: 1 };
  }
  try {
    const card = await ctx.runQuery(functions().getRawCard, { cardId });
    if (!card) {
      return { archived, skipped: 1 };
    }
    for (const kind of ["linkPreview", "linkCategory"] as const) {
      const raw = card.metadata?.[kind]?.raw;
      if (raw === undefined) {
        continue;
      }
      const json = serializeArchivableRaw(raw);
      if (json === null) {
        skipped += 1;
        continue;
      }
      const digest = await hashRawMetadata(json);
      const key = rawMetadataKey(card, kind, digest);
      await copyAndVerifyRaw(card, kind, json, digest);
      if (
        await ctx.runMutation(functions().commitArchive, {
          cardId,
          kind,
          expectedJson: json,
          key,
          digest,
        })
      ) {
        archived += 1;
      } else {
        skipped += 1;
      }
    }
  } catch (error) {
    // A failed copy/verification retains the entire inline payload. Retry
    // boundedly; later explicit maintenance can retry exhausted items.
    if (attempt < 2) {
      await ctx.scheduler.runAfter(
        60_000 * (attempt + 1),
        functions().archiveCard,
        { cardId, attempt: attempt + 1 }
      );
    }
    throw error;
  }
  return { archived, skipped };
};

export const archiveCard = internalAction({
  args: { cardId: v.id("cards"), attempt: v.optional(v.number()) },
  returns: v.object({ archived: v.number(), skipped: v.number() }),
  handler: archiveCardHandler,
});

export const pageInlineRaw = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.object({
    cursor: v.union(v.string(), v.null()),
    cards: v.array(v.object({ cardId: v.id("cards"), bytes: v.number() })),
  }),
  handler: async (ctx, { cursor, limit = 25 }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("limit must be between 1 and 50");
    }
    const page = await ctx.db.query("cards").paginate({
      cursor: cursor ?? null,
      numItems: limit,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    return {
      cursor: page.isDone ? null : page.continueCursor,
      cards: page.page.flatMap((card) => {
        const json = [
          card.metadata?.linkPreview?.raw,
          card.metadata?.linkCategory?.raw,
        ]
          .map(serializeArchivableRaw)
          .filter((value): value is string => value !== null);
        return json.length
          ? [
              {
                cardId: card._id,
                bytes: json.reduce(
                  (sum, value) =>
                    sum + new TextEncoder().encode(value).byteLength,
                  0
                ),
              },
            ]
          : [];
      }),
    };
  },
});

// One explicit bounded page per call. Default is read-only; never schedules a
// whole-table migration or runs automatically on deployment.
export const archivePage = internalAction({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    cursor: v.union(v.string(), v.null()),
    cards: v.array(v.object({ cardId: v.id("cards"), bytes: v.number() })),
    dryRun: v.boolean(),
    archived: v.number(),
    skipped: v.number(),
    failed: v.array(v.object({ cardId: v.id("cards"), error: v.string() })),
  }),
  handler: async (
    ctx,
    { cursor, limit, dryRun = true }
  ): Promise<{
    cursor: string | null;
    cards: { cardId: Id<"cards">; bytes: number }[];
    dryRun: boolean;
    archived: number;
    skipped: number;
    failed: { cardId: Id<"cards">; error: string }[];
  }> => {
    const page = await ctx.runQuery(functions().pageInlineRaw, {
      cursor,
      limit,
    });
    let archived = 0;
    let skipped = 0;
    const failed: { cardId: Id<"cards">; error: string }[] = [];
    const startedAt = Date.now();
    if (!dryRun) {
      for (const { cardId } of page.cards) {
        // Leave time for a card's bounded network requests. Return every
        // unattempted ID so operators can retry it without losing the cursor.
        if (Date.now() - startedAt >= 4 * 60_000) {
          failed.push({ cardId, error: "time_budget" });
          continue;
        }
        try {
          const result = await archiveCardHandler(ctx, { cardId });
          archived += result.archived;
          skipped += result.skipped;
        } catch {
          // Inline raw is retained and the card schedules its bounded retry.
          // One bad object must not prevent the rest of a page progressing.
          failed.push({ cardId, error: "archive_failed" });
        }
      }
    }
    return { ...page, dryRun, archived, skipped, failed };
  },
});
