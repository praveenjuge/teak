import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { ensureCardUsageShards } from "../../card/cardUsage";
import { insertCard, type NewCard } from "../../card/cardWrites";

/**
 * Inserts a card through the one card write path, counted as on Pro so a
 * test can hold any number of cards.
 */
export const insertTestCard = async (
  ctx: MutationCtx,
  card: NewCard
): Promise<Id<"cards">> => {
  await ensureCardUsageShards(ctx, card.userId, true);
  return await insertCard(ctx, card, { hasPremium: true });
};
