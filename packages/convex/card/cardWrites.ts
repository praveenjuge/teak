import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { accountDeletionOwnsRows } from "../accountDeletion";
import { recordActiveCardCreated } from "./cardUsage";
import {
  DERIVED_CARD_FIELDS,
  type DerivedCardFields,
  deriveCardFields,
} from "./derivedFields";
import { CARD_CHANGE_FIELDS, onCardChanged } from "./onCardChanged";
import { newShuffleKey } from "./shuffle";

/**
 * Every write to a card that changes what it shows or where it's found goes
 * through `insertCard` or `patchCard`. They set the derived fields
 * (`deriveCardFields`), `savedAt` and `shuffleKey`, keep the free plan's count,
 * and run `onCardChanged` in the same transaction. A raw `ctx.db.patch` is
 * left only for fields nothing derives from and the hook doesn't read
 * (`pinPosition`, `processingRev`, operational bookkeeping) and for backfills
 * that repair derived fields themselves.
 */

export type CardPatch = Partial<WithoutSystemFields<Doc<"cards">>>;

export type NewCard = Omit<
  WithoutSystemFields<Doc<"cards">>,
  keyof DerivedCardFields | "savedAt" | "shuffleKey"
> & {
  /** When the card was last saved; defaults to `createdAt`. */
  savedAt?: number;
  shuffleKey?: number;
};

const changedDerivedFields = (
  card: Partial<Doc<"cards">>,
  next: DerivedCardFields
): Partial<DerivedCardFields> => {
  const changed: Partial<DerivedCardFields> = {};
  for (const field of DERIVED_CARD_FIELDS) {
    if (card[field] !== next[field]) {
      Object.assign(changed, { [field]: next[field] });
    }
  }
  return changed;
};

/**
 * Inserts a card, counts it toward the free plan when it isn't in Trash, and
 * runs the change hook. At the limit the card is deleted again before the
 * error leaves: callers that catch `CARD_LIMIT_REACHED` per item (bulk create,
 * import) would otherwise commit it uncounted, and Convex has no savepoints.
 * `finish` adds fields that need the card's id (folder rows, transcripts)
 * before the hook runs.
 */
export const insertCard = async (
  ctx: MutationCtx,
  card: NewCard,
  options: {
    finish?: (card: Doc<"cards">) => Promise<CardPatch | undefined>;
    hasPremium?: boolean;
  } = {}
): Promise<Id<"cards">> => {
  const full = {
    ...card,
    savedAt: card.savedAt ?? card.createdAt,
    shuffleKey: card.shuffleKey ?? newShuffleKey(),
  };
  const cardId = await ctx.db.insert("cards", {
    ...full,
    ...deriveCardFields(full),
  });
  if (!card.isDeleted) {
    try {
      await recordActiveCardCreated(ctx, card.userId, cardId, {
        hasPremium: options.hasPremium,
      });
    } catch (error) {
      await ctx.db.delete("cards", cardId);
      throw error;
    }
  }
  if (options.finish) {
    const inserted = (await ctx.db.get("cards", cardId)) as Doc<"cards">;
    const extra = await options.finish(inserted);
    if (extra && Object.keys(extra).length > 0) {
      await ctx.db.patch("cards", cardId, {
        ...extra,
        ...changedDerivedFields(
          inserted,
          deriveCardFields({ ...inserted, ...extra })
        ),
      });
    }
  }
  await onCardChanged(ctx, cardId, card.userId);
  return cardId;
};

/**
 * Patches a card, with its derived fields kept in step, and runs the change
 * hook when the patch touches a field it reads. False when account deletion
 * owns the card's rows and nothing was written.
 */
export const patchCard = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  value: CardPatch
): Promise<boolean> => {
  const card = await ctx.db.get("cards", cardId);
  if (await accountDeletionOwnsRows(ctx, card?.userId)) {
    return false;
  }
  await ctx.db.patch("cards", cardId, {
    ...value,
    ...(card
      ? changedDerivedFields(card, deriveCardFields({ ...card, ...value }))
      : {}),
  });
  if (Object.keys(value).some((field) => CARD_CHANGE_FIELDS.has(field))) {
    await onCardChanged(ctx, cardId, undefined, card ?? undefined);
  }
  return true;
};
