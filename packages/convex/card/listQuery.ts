import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
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

/**
 * A folder's rows (`folderCards`) in `createdAt` order, honoring Trash and
 * Archive like the library: active cards by default, archived ones with
 * `archived: "only"`, trashed ones with `trash`. Callers load each row's card.
 */
export const buildFolderCardListQuery = (
  ctx: QueryCtx,
  options: {
    archived?: ArchivedFilter;
    createdAt?: CreatedAtBounds;
    folderId: Id<"folders">;
    trash?: boolean;
    types?: readonly CardType[];
  }
) => {
  const types = options.types?.length ? options.types : undefined;
  const archived = archivedFilterMatch(options.archived, options.trash);
  const bounds = options.createdAt;
  const withDates = (range: RangeBuilder): RangeBuilder => {
    let next = range;
    if (bounds?.gte !== undefined) {
      next = next.gte("cardCreatedAt", bounds.gte);
    }
    if (bounds?.lte !== undefined) {
      next = next.lte("cardCreatedAt", bounds.lte);
    } else if (bounds?.lt !== undefined) {
      next = next.lt("cardCreatedAt", bounds.lt);
    }
    return next;
  };
  const isDeleted = options.trash ? (true as const) : undefined;
  // Trash, or archived and not: rows of both archive states, ordered by date
  // across them.
  const dated =
    archived === "any"
      ? ctx.db
          .query("folderCards")
          .withIndex("by_folderId_and_isDeleted_and_cardCreatedAt", (q) =>
            withDates(
              q.eq("folderId", options.folderId).eq("isDeleted", isDeleted)
            )
          )
      : ctx.db
          .query("folderCards")
          .withIndex(
            "by_folderId_and_isDeleted_and_isArchived_and_cardCreatedAt",
            (q) =>
              withDates(
                q
                  .eq("folderId", options.folderId)
                  .eq("isDeleted", isDeleted)
                  .eq("isArchived", archived)
              )
          );
  return types
    ? dated.filter((q) =>
        types
          .map((type) => q.eq(q.field("type"), type))
          .reduce((acc, condition) => q.or(acc, condition))
      )
    : dated;
};

/**
 * Cards with one tag, from the tag index in date order: Trash, Archive or
 * the library. `tag` is the lowercase name the index stores. Types and
 * favorites narrow the index range; other filters apply to the cards.
 */
export const buildTagCardListQuery = (
  ctx: QueryCtx,
  options: {
    archived?: ArchivedFilter;
    createdAt?: CreatedAtBounds;
    favoritesOnly?: boolean;
    tag: string;
    trash?: boolean;
    types?: readonly CardType[];
    userId: string;
  }
) => {
  const types = options.types?.length ? options.types : undefined;
  const archived = archivedFilterMatch(options.archived, options.trash);
  const bounds = options.createdAt;
  const withDates = (range: RangeBuilder): RangeBuilder => {
    let next = range;
    if (bounds?.gte !== undefined) {
      next = next.gte("cardCreatedAt", bounds.gte);
    }
    if (bounds?.lte !== undefined) {
      next = next.lte("cardCreatedAt", bounds.lte);
    } else if (bounds?.lt !== undefined) {
      next = next.lt("cardCreatedAt", bounds.lt);
    }
    return next;
  };
  const isDeleted = options.trash ? (true as const) : undefined;
  const dated =
    archived === "any"
      ? ctx.db
          .query("cardSearchTags")
          .withIndex("by_user_tag_deleted_created", (q) =>
            withDates(
              q
                .eq("userId", options.userId)
                .eq("tag", options.tag)
                .eq("isDeleted", isDeleted)
            )
          )
      : ctx.db
          .query("cardSearchTags")
          .withIndex("by_user_tag_deleted_archived_created_v2", (q) =>
            withDates(
              q
                .eq("userId", options.userId)
                .eq("tag", options.tag)
                .eq("isDeleted", isDeleted)
                .eq("isArchived", archived)
            )
          );
  if (!(types || options.favoritesOnly)) {
    return dated;
  }
  return dated.filter((q) => {
    const typeMatch = types
      ? types
          .map((type) => q.eq(q.field("type"), type))
          .reduce((acc, condition) => q.or(acc, condition))
      : true;
    return options.favoritesOnly
      ? q.and(typeMatch, q.eq(q.field("isFavorited"), true))
      : typeMatch;
  });
};
