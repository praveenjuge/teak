import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { CardType } from "../schema";

export {
  type CardListSort,
  compareCardsByCreatedAt,
  normalizeCardListSort,
} from "../shared/search/sort";

export const cardListSortValidator = v.union(
  v.literal("newest"),
  v.literal("oldest")
);

/**
 * Which archived cards a library read returns: none (the default), only
 * archived ones (the Archive view), or both. Trash ignores it and lists every
 * trashed card, archived or not.
 */
export type ArchivedFilter = "exclude" | "only" | "include";

export const archivedFilterValidator = v.union(
  v.literal("exclude"),
  v.literal("only"),
  v.literal("include")
);

/**
 * The `isArchived` value an index or search filter should match, or `"any"`
 * when the read must not constrain it (Trash, or archived and not).
 */
export const archivedFilterMatch = (
  archived: ArchivedFilter | undefined,
  trash?: boolean
): true | undefined | "any" => {
  if (trash || archived === "include") {
    return "any";
  }
  return archived === "only" ? true : undefined;
};

/** Bounds on `createdAt`. A missing bound leaves that side open. */
export interface CreatedAtBounds {
  gte?: number;
  lt?: number;
  lte?: number;
}

export interface CardListQueryOptions {
  /** Archived cards to return outside Trash; defaults to `"exclude"`. */
  archived?: ArchivedFilter;
  createdAt?: CreatedAtBounds;
  /** Only favorites. `false` means "no favorite filter", like `undefined`. */
  favoritesOnly?: boolean;
  /** List Trash instead of the library. */
  trash?: boolean;
  /** One type uses its own index; several are filtered while reading. */
  types?: readonly CardType[];
  userId: string;
}

// The index range builders are generic per index; the createdAt bounds apply
// the same way to every index below because createdAt is its last field.
type RangeBuilder = any;

const withCreatedAt = (range: RangeBuilder, bounds?: CreatedAtBounds) => {
  let next = range;
  if (bounds?.gte !== undefined) {
    next = next.gte("createdAt", bounds.gte);
  }
  if (bounds?.lte !== undefined) {
    next = next.lte("createdAt", bounds.lte);
  } else if (bounds?.lt !== undefined) {
    next = next.lt("createdAt", bounds.lt);
  }
  return next;
};

/**
 * The one query behind every library listing (web grid, mobile summaries,
 * public API, Raycast): the most selective index for the filters, ordered by
 * `createdAt`. Archived cards are left out unless `archived` asks for them;
 * Trash includes them. Callers choose the direction with `.order()`:
 * `"desc"` for newest, `"asc"` for oldest.
 */
export const buildCardListQuery = (
  ctx: QueryCtx,
  options: CardListQueryOptions
) => {
  const { userId, createdAt } = options;
  const types = options.types?.length ? options.types : undefined;
  const singleType = types?.length === 1 ? types[0] : undefined;
  const cards = ctx.db.query("cards");
  const archived = archivedFilterMatch(options.archived, options.trash);

  if (archived === "any") {
    // Trash, or the library with archived cards in it: the index without
    // isArchived covers both.
    const query = cards.withIndex("by_user_deleted_created", (q) =>
      withCreatedAt(
        q
          .eq("userId", userId)
          .eq("isDeleted", options.trash ? true : undefined),
        createdAt
      )
    );
    const ofTypes = types
      ? query.filter((q) =>
          types
            .map((type) => q.eq(q.field("type"), type))
            .reduce((acc, condition) => q.or(acc, condition))
        )
      : query;
    return options.favoritesOnly
      ? ofTypes.filter((q) => q.eq(q.field("isFavorited"), true))
      : ofTypes;
  }

  if (options.favoritesOnly) {
    const query = cards.withIndex(
      "by_user_deleted_archived_favorited_created",
      (q) =>
        withCreatedAt(
          q
            .eq("userId", userId)
            .eq("isDeleted", undefined)
            .eq("isArchived", archived)
            .eq("isFavorited", true),
          createdAt
        )
    );
    return types
      ? query.filter((q) =>
          types
            .map((type) => q.eq(q.field("type"), type))
            .reduce((acc, condition) => q.or(acc, condition))
        )
      : query;
  }

  if (singleType) {
    return cards.withIndex("by_user_deleted_archived_type_created", (q) =>
      withCreatedAt(
        q
          .eq("userId", userId)
          .eq("isDeleted", undefined)
          .eq("isArchived", archived)
          .eq("type", singleType),
        createdAt
      )
    );
  }

  const query = cards.withIndex("by_user_deleted_archived_created", (q) =>
    withCreatedAt(
      q
        .eq("userId", userId)
        .eq("isDeleted", undefined)
        .eq("isArchived", archived),
      createdAt
    )
  );
  return types
    ? query.filter((q) =>
        types
          .map((type) => q.eq(q.field("type"), type))
          .reduce((acc, condition) => q.or(acc, condition))
      )
    : query;
};
