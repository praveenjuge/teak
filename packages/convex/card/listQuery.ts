import type { IndexRange } from "convex/server";
import { v } from "convex/values";
import {
  mergedStream,
  type QueryStream,
  stream,
} from "convex-helpers/server/stream";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import schema, { type CardType } from "../schema";
import { excludeHiddenRows } from "./hiddenCards";

export {
  type CardListSort,
  compareCardsBySavedAt,
  normalizeCardListSort,
  savedAtOf,
} from "../shared/search/sort";

export const cardListSortValidator = v.union(
  v.literal("newest"),
  v.literal("oldest")
);

export const cardListSortWithShuffleValidator = v.union(
  v.literal("newest"),
  v.literal("oldest"),
  v.literal("relevance"),
  v.literal("shuffle")
);

/** The public `archived` filter: none (the default), only archived, or both. */
export type ArchivedFilter = "exclude" | "only" | "include";

export const archivedFilterValidator = v.union(
  v.literal("exclude"),
  v.literal("only"),
  v.literal("include")
);

/**
 * Which cards a read returns: the library (unarchived, the default), the
 * Archive view, both, or Trash (every trashed card, archived or not).
 */
export type CardListScope =
  | "library"
  | "archive"
  | "libraryAndArchive"
  | "trash";

export const cardListScope = (
  archived: ArchivedFilter | undefined,
  trash?: boolean
): CardListScope => {
  if (trash) {
    return "trash";
  }
  if (archived === "only") {
    return "archive";
  }
  return archived === "include" ? "libraryAndArchive" : "library";
};

/** The `isArchived` index value a scope reads; `"any"` reads every value. */
export const scopeArchivedMatch = (
  scope: CardListScope = "library"
): true | undefined | "any" => {
  if (scope === "trash" || scope === "libraryAndArchive") {
    return "any";
  }
  return scope === "archive" ? true : undefined;
};

/** The `isDeleted` index value a scope reads. */
export const scopeDeletedMatch = (
  scope: CardListScope = "library"
): true | undefined => (scope === "trash" ? true : undefined);

/**
 * Bounds on when a card was last saved (`savedAt`; `cardSavedAt` on folder
 * and tag rows). Date words ("last week") and `createdAfter`/`createdBefore`
 * keep their names for clients but bound this date.
 */
export interface SavedAtBounds {
  gte?: number;
  lt?: number;
  lte?: number;
}

export interface CardListQueryOptions {
  favoritesOnly?: boolean;
  // Callers still drop loaded cards with `keepVisible` for the ones the
  // `isHidden` backfill hasn't reached.
  includeHidden?: boolean;
  savedAt?: SavedAtBounds;
  /**
   * Reads hidden rows too, so a caller's row budget counts every row read;
   * the caller drops hidden cards itself.
   */
  scanHiddenRows?: boolean;
  scope?: CardListScope;
  types?: readonly CardType[];
  userId: string;
}

interface UpperBoundRange<Field extends string> extends IndexRange {
  lt: (field: Field, value: number) => IndexRange;
  lte: (field: Field, value: number) => IndexRange;
}

interface DateBoundRange<Field extends string> extends UpperBoundRange<Field> {
  gte: (field: Field, value: number) => UpperBoundRange<Field>;
}

const withDateBounds = <Field extends string>(
  range: DateBoundRange<Field>,
  field: Field,
  bounds?: SavedAtBounds
): IndexRange => {
  const lower =
    bounds?.gte === undefined ? range : range.gte(field, bounds.gte);
  if (bounds?.lte !== undefined) {
    return lower.lte(field, bounds.lte);
  }
  if (bounds?.lt !== undefined) {
    return lower.lt(field, bounds.lt);
  }
  return lower;
};

const withSavedAt = (
  range: DateBoundRange<"savedAt">,
  bounds?: SavedAtBounds
) => withDateBounds(range, "savedAt", bounds);

export const buildCardListQuery = (
  ctx: QueryCtx,
  options: CardListQueryOptions
) =>
  excludeHiddenRows(
    cardListIndexQuery(ctx, options),
    options.includeHidden || options.scanHiddenRows
  );

const cardListIndexQuery = (ctx: QueryCtx, options: CardListQueryOptions) => {
  const { userId, savedAt } = options;
  const types = options.types?.length ? options.types : undefined;
  const singleType = types?.length === 1 ? types[0] : undefined;
  const cards = ctx.db.query("cards");
  const archived = scopeArchivedMatch(options.scope);

  if (archived === "any") {
    const query = cards.withIndex("by_user_deleted_saved", (q) =>
      withSavedAt(
        q
          .eq("userId", userId)
          .eq("isDeleted", scopeDeletedMatch(options.scope)),
        savedAt
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
      "by_user_deleted_archived_favorited_saved",
      (q) =>
        withSavedAt(
          q
            .eq("userId", userId)
            .eq("isDeleted", undefined)
            .eq("isArchived", archived)
            .eq("isFavorited", true),
          savedAt
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
    return cards.withIndex("by_user_deleted_archived_type_saved", (q) =>
      withSavedAt(
        q
          .eq("userId", userId)
          .eq("isDeleted", undefined)
          .eq("isArchived", archived)
          .eq("type", singleType),
        savedAt
      )
    );
  }

  const query = cards.withIndex("by_user_deleted_archived_saved", (q) =>
    withSavedAt(
      q
        .eq("userId", userId)
        .eq("isDeleted", undefined)
        .eq("isArchived", archived),
      savedAt
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
 * Rows a paginated card list may read for one page. A list whose index
 * doesn't cover every filter (several types, favourites across archive
 * states, hidden cards) stops here and returns a short page.
 */
export const CARD_LIST_PAGE_ROW_LIMIT = 400;

/**
 * The cards `buildCardListQuery` returns, read as one index range per archive
 * state and type and merged in date order, so several types or favourites
 * across archive states read only rows that can match. `residual` is the one
 * check no index covers (types among favourites): apply it to every row read.
 * Only for reads that don't paginate: a merged stream can't pin a reactive
 * page's end the way `.paginate()` does.
 */
export const cardListStream = (
  ctx: QueryCtx,
  options: CardListQueryOptions,
  order: "asc" | "desc"
): {
  residual?: (card: Doc<"cards">) => boolean;
  rows: QueryStream<Doc<"cards">>;
} => {
  const { userId, savedAt } = options;
  const types = options.types?.length
    ? Array.from(new Set(options.types))
    : undefined;
  const archived = scopeArchivedMatch(options.scope);
  const states = archived === "any" ? [undefined, true as const] : [archived];
  const isDeleted = scopeDeletedMatch(options.scope);
  const cards = () => stream(ctx.db, schema).query("cards");
  if (options.favoritesOnly) {
    return {
      rows: mergedStream(
        states.map((state) =>
          cards()
            .withIndex("by_user_deleted_archived_favorited_saved", (q) =>
              withSavedAt(
                q
                  .eq("userId", userId)
                  .eq("isDeleted", isDeleted)
                  .eq("isArchived", state)
                  .eq("isFavorited", true),
                savedAt
              )
            )
            .order(order)
        ),
        ["savedAt"]
      ),
      residual: types ? (card) => types.includes(card.type) : undefined,
    };
  }
  if (types) {
    return {
      rows: mergedStream(
        states.flatMap((state) =>
          types.map((type) =>
            cards()
              .withIndex("by_user_deleted_archived_type_saved", (q) =>
                withSavedAt(
                  q
                    .eq("userId", userId)
                    .eq("isDeleted", isDeleted)
                    .eq("isArchived", state)
                    .eq("type", type),
                  savedAt
                )
              )
              .order(order)
          )
        ),
        ["savedAt"]
      ),
    };
  }
  return {
    rows: mergedStream(
      states.map((state) =>
        cards()
          .withIndex("by_user_deleted_archived_saved", (q) =>
            withSavedAt(
              q
                .eq("userId", userId)
                .eq("isDeleted", isDeleted)
                .eq("isArchived", state),
              savedAt
            )
          )
          .order(order)
      ),
      ["savedAt"]
    ),
  };
};

/** The first `limit` cards `buildCardListQuery` returns, in `order`. */
export const takeCardList = (
  ctx: QueryCtx,
  options: CardListQueryOptions,
  order: "asc" | "desc",
  limit: number
): Promise<Doc<"cards">[]> => {
  const { rows, residual } = cardListStream(ctx, options, order);
  const skipHidden = !(options.includeHidden || options.scanHiddenRows);
  if (!(residual || skipHidden)) {
    return rows.take(limit);
  }
  return rows
    .filterWith((card) =>
      Promise.resolve(
        (!residual || residual(card)) && !(skipHidden && card.isHidden === true)
      )
    )
    .take(limit);
};

export const buildHostCardListQuery = (
  ctx: QueryCtx,
  options: {
    savedAt?: SavedAtBounds;
    host: string;
    includeHidden?: boolean;
    scope?: "library" | "archive";
    userId: string;
  }
) =>
  excludeHiddenRows(
    ctx.db
      .query("cards")
      .withIndex("by_user_deleted_archived_host_saved", (q) =>
        withSavedAt(
          q
            .eq("userId", options.userId)
            .eq("isDeleted", undefined)
            .eq("isArchived", options.scope === "archive" ? true : undefined)
            .eq("urlHost", options.host),
          options.savedAt
        )
      ),
    options.includeHidden
  );

export const buildFolderCardListQuery = (
  ctx: QueryCtx,
  options: {
    savedAt?: SavedAtBounds;
    folderId: Id<"folders">;
    scope?: CardListScope;
    types?: readonly CardType[];
  }
) => {
  const types = options.types?.length ? options.types : undefined;
  const archived = scopeArchivedMatch(options.scope);
  const bounds = options.savedAt;
  const withDates = (range: DateBoundRange<"cardSavedAt">) =>
    withDateBounds(range, "cardSavedAt", bounds);
  const isDeleted = scopeDeletedMatch(options.scope);
  const dated =
    archived === "any"
      ? ctx.db
          .query("folderCards")
          .withIndex("by_folderId_and_isDeleted_and_cardSavedAt", (q) =>
            withDates(
              q.eq("folderId", options.folderId).eq("isDeleted", isDeleted)
            )
          )
      : ctx.db
          .query("folderCards")
          .withIndex(
            "by_folderId_and_isDeleted_and_isArchived_and_cardSavedAt",
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

// Hidden cards are included: callers drop them with `keepVisible`.
export const buildTagCardListQuery = (
  ctx: QueryCtx,
  options: {
    savedAt?: SavedAtBounds;
    favoritesOnly?: boolean;
    scope?: CardListScope;
    tag: string;
    types?: readonly CardType[];
    userId: string;
  }
) => {
  const types = options.types?.length ? options.types : undefined;
  const archived = scopeArchivedMatch(options.scope);
  const bounds = options.savedAt;
  const withDates = (range: DateBoundRange<"cardSavedAt">) =>
    withDateBounds(range, "cardSavedAt", bounds);
  const isDeleted = scopeDeletedMatch(options.scope);
  const singleType = types?.length === 1 ? types[0] : undefined;
  const favorited = options.favoritesOnly === true;
  const anyArchived = archived === "any";
  const { userId, tag } = options;
  const tagRows = () => {
    const rows = ctx.db.query("cardSearchTags");
    if (anyArchived) {
      return rows.withIndex("by_user_tag_deleted_saved", (q) =>
        withDates(
          q.eq("userId", userId).eq("tag", tag).eq("isDeleted", isDeleted)
        )
      );
    }
    if (singleType && favorited) {
      return rows.withIndex(
        "by_user_tag_deleted_archived_type_favorited_saved",
        (q) =>
          withDates(
            q
              .eq("userId", userId)
              .eq("tag", tag)
              .eq("isDeleted", isDeleted)
              .eq("isArchived", archived)
              .eq("type", singleType)
              .eq("isFavorited", true)
          )
      );
    }
    if (singleType) {
      return rows.withIndex("by_user_tag_deleted_archived_type_saved", (q) =>
        withDates(
          q
            .eq("userId", userId)
            .eq("tag", tag)
            .eq("isDeleted", isDeleted)
            .eq("isArchived", archived)
            .eq("type", singleType)
        )
      );
    }
    if (favorited) {
      return rows.withIndex(
        "by_user_tag_deleted_archived_favorited_saved",
        (q) =>
          withDates(
            q
              .eq("userId", userId)
              .eq("tag", tag)
              .eq("isDeleted", isDeleted)
              .eq("isArchived", archived)
              .eq("isFavorited", true)
          )
      );
    }
    return rows.withIndex("by_user_tag_deleted_archived_saved", (q) =>
      withDates(
        q
          .eq("userId", userId)
          .eq("tag", tag)
          .eq("isDeleted", isDeleted)
          .eq("isArchived", archived)
      )
    );
  };
  const dated = tagRows();
  const typeFiltered = anyArchived || !singleType ? types : undefined;
  if (!(typeFiltered || (anyArchived && favorited))) {
    return dated;
  }
  return dated.filter((q) => {
    const checks = [
      ...(typeFiltered
        ? [
            typeFiltered
              .map((type) => q.eq(q.field("type"), type))
              .reduce((acc, condition) => q.or(acc, condition)),
          ]
        : []),
      ...(anyArchived && favorited ? [q.eq(q.field("isFavorited"), true)] : []),
    ];
    return checks.length === 1 ? checks[0] : q.and(...checks);
  });
};
