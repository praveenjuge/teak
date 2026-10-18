import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { accountDeletionOwnsRows } from "../accountDeletion";
import { ensureObjectOwnership } from "./ownership";
import { cardStorageObjectKeys, deleteObject } from "./r2";
import {
  copyAndVerifyRaw,
  hashRawMetadata,
  RAW_METADATA_KINDS,
  type RawMetadataKind,
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
const ARCHIVE_PAGE_TIME_BUDGET_MS = 4 * 60_000;

export const getRawCard = internalQuery({
  args: { cardId: v.id("cards") },
  returns: v.any(),
  handler: (ctx, { cardId }) => ctx.db.get("cards", cardId),
});

type CommitOutcome =
  | "card_gone"
  | "account_deleting"
  | "mismatched_copy"
  | "raw_changed"
  | "already_committed"
  | "committed";

const retainUnreferencedArchiveKey = async (
  ctx: MutationCtx,
  card: Doc<"cards">,
  key: string
) => {
  if (!cardStorageObjectKeys(card).includes(key)) {
    await ctx.db.patch("cards", card._id, {
      workflowArtifactKeys: [...(card.workflowArtifactKeys ?? []), key],
    });
  }
};

const commitArchiveOutcome = async (
  ctx: MutationCtx,
  {
    cardId,
    kind,
    expectedJson,
    key,
    digest,
  }: {
    cardId: Id<"cards">;
    kind: RawMetadataKind;
    expectedJson: string;
    key: string;
    digest: string;
  }
): Promise<CommitOutcome> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    await deleteObject(ctx, key);
    return "card_gone";
  }
  if (await accountDeletionOwnsRows(ctx, card.userId)) {
    if (card.metadata?.[kind]?.rawStorageKey !== key) {
      await deleteObject(ctx, key);
    }
    return "account_deleting";
  }
  if (
    key !== rawMetadataKey(card, kind, digest) ||
    (await hashRawMetadata(expectedJson)) !== digest
  ) {
    return "mismatched_copy";
  }
  const part = card.metadata?.[kind];
  if (
    part?.raw === undefined &&
    part?.rawStorageKey === key &&
    part?.rawSha256 === digest
  ) {
    return "already_committed";
  }
  if (
    !part ||
    part.raw === undefined ||
    serializeRawMetadata(part.raw) !== expectedJson
  ) {
    await retainUnreferencedArchiveKey(ctx, card, key);
    return "raw_changed";
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
  await ctx.db.patch("cards", cardId, {
    metadata: { ...card.metadata, [kind]: archived },
  });
  return "committed";
};

export const commitArchive = internalMutation({
  args: {
    cardId: v.id("cards"),
    kind: kindValidator,
    expectedJson: v.string(),
    key: v.string(),
    digest: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const outcome = await commitArchiveOutcome(ctx, args);
    return outcome === "committed" || outcome === "already_committed";
  },
});

const COMMIT_RETRY_DELAY_MS = 60_000;
const CARD_RETRY_DELAY_MS = 60_000;
const MAX_ARCHIVE_ATTEMPT = 2;

type KindOutcome =
  | { kind: "archived" }
  | { kind: "skipped" }
  | { kind: "commit_failed"; error: unknown };

const archiveKind = async (
  ctx: ActionCtx,
  card: Doc<"cards">,
  kind: RawMetadataKind
): Promise<KindOutcome> => {
  const json = serializeArchivableRaw(card.metadata?.[kind]?.raw);
  if (json === null) {
    return { kind: "skipped" };
  }
  const digest = await hashRawMetadata(json);
  const key = rawMetadataKey(card, kind, digest);
  await ensureObjectOwnership(ctx, card.userId, key);
  await copyAndVerifyRaw(card, kind, json, digest);
  const commitArgs = {
    cardId: card._id,
    kind,
    expectedJson: json,
    key,
    digest,
  };
  try {
    const committed = await ctx.runMutation(
      functions().commitArchive,
      commitArgs
    );
    return { kind: committed ? "archived" : "skipped" };
  } catch (error) {
    await ctx.scheduler.runAfter(
      COMMIT_RETRY_DELAY_MS,
      functions().commitArchive,
      commitArgs
    );
    return { kind: "commit_failed", error };
  }
};

export const archiveCardHandler = async (
  ctx: ActionCtx,
  { cardId, attempt = 0 }: { cardId: Id<"cards">; attempt?: number }
): Promise<{ archived: number; skipped: number }> => {
  if (
    !Number.isInteger(attempt) ||
    attempt < 0 ||
    attempt > MAX_ARCHIVE_ATTEMPT
  ) {
    throw new Error("invalid_archive_attempt");
  }
  let archived = 0;
  let skipped = 0;
  if (!rawArchivalConfigured()) {
    return { archived, skipped: 1 };
  }
  let commitFailure: { error: unknown } | null = null;
  try {
    const card: Doc<"cards"> | null = await ctx.runQuery(
      functions().getRawCard,
      { cardId }
    );
    if (!card) {
      return { archived, skipped: 1 };
    }
    for (const kind of RAW_METADATA_KINDS) {
      if (card.metadata?.[kind]?.raw === undefined) {
        continue;
      }
      const outcome = await archiveKind(ctx, card, kind);
      if (outcome.kind === "archived") {
        archived += 1;
      } else if (outcome.kind === "skipped") {
        skipped += 1;
      } else {
        commitFailure ??= outcome;
      }
    }
  } catch (error) {
    if (attempt < MAX_ARCHIVE_ATTEMPT) {
      await ctx.scheduler.runAfter(
        CARD_RETRY_DELAY_MS * (attempt + 1),
        functions().archiveCard,
        { cardId, attempt: attempt + 1 }
      );
    }
    throw error;
  }
  if (commitFailure) {
    throw commitFailure.error;
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
        if (Date.now() - startedAt >= ARCHIVE_PAGE_TIME_BUDGET_MS) {
          failed.push({ cardId, error: "time_budget" });
          continue;
        }
        try {
          const result = await archiveCardHandler(ctx, { cardId });
          archived += result.archived;
          skipped += result.skipped;
        } catch {
          failed.push({ cardId, error: "archive_failed" });
        }
      }
    }
    return { ...page, dryRun, archived, skipped, failed };
  },
});
