import type { NamedTableInfo, Query } from "convex/server";
import type { DataModel, Doc } from "../_generated/dataModel";
import { isCardHidden, isHiddenTagList } from "../shared/tags";

/**
 * Hidden cards: a card whose user tags hold a reserved tag (`secret`,
 * `hidden`) stores `isHidden: true` and is left out of every list
 * and search, unless the search names one of those tags. Get by id,
 * `/v1/cards/changes` and exports still return it.
 */

/**
 * A card write with `isHidden` kept beside changed `tags`, so the flag lands
 * in the same write (the search sync repairs any write without it).
 */
export const withHiddenFlag = <T extends object>(value: T): T => {
  if (!("tags" in value)) {
    return value;
  }
  const { tags } = value as { tags?: unknown };
  return {
    ...value,
    isHidden:
      Array.isArray(tags) && isHiddenTagList(tags as string[])
        ? (true as const)
        : undefined,
  };
};

/** Whether a search for these tags shows hidden cards. */
export const revealsHidden = (tags: readonly (string | undefined)[]) =>
  isHiddenTagList(tags.filter((tag): tag is string => Boolean(tag)));

type CardQuery = Query<NamedTableInfo<DataModel, "cards">>;

/**
 * Leaves flagged cards out of an index read. A card the backfill hasn't
 * reached passes, so callers still drop loaded cards with `keepVisible`.
 */
export const excludeHiddenRows = <Q extends CardQuery>(
  query: Q,
  includeHidden?: boolean
): Q =>
  includeHidden
    ? query
    : (query.filter((q) => q.neq(q.field("isHidden"), true)) as Q);

/** The loaded cards a read may return. */
export const keepVisible = <T extends Pick<Doc<"cards">, "isHidden" | "tags">>(
  cards: T[],
  includeHidden?: boolean
): T[] => (includeHidden ? cards : cards.filter((card) => !isCardHidden(card)));
