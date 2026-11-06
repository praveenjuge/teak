import type { NamedTableInfo, Query } from "convex/server";
import type { DataModel, Doc } from "../_generated/dataModel";
import { isCardHidden, isHiddenTagList } from "../shared/tags";

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

export const keepVisible = <T extends Pick<Doc<"cards">, "isHidden" | "tags">>(
  cards: T[],
  includeHidden?: boolean
): T[] => (includeHidden ? cards : cards.filter((card) => !isCardHidden(card)));
