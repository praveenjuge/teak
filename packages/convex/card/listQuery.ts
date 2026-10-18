import type { IndexRange } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CardType } from "../schema";
import { excludeHiddenRows } from "./hiddenCards";

export {
  type CardListSort,
  compareCardsByCreatedAt,
  normalizeCardListSort,
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

export const archivedFilterMatch = (
  archived: ArchivedFilter | undefined,
  trash?: boolean
): true | undefined | "any" => {
  if (trash || archived === "include") {
    return "any";
  }
  return archived === "only" ? true : undefined;
};

export interface CreatedAtBounds {
  gte?: number;
  lt?: number;
  lte?: number;
}

export interface CardListQueryOptions {
  archived?: ArchivedFilter;
  createdAt?: CreatedAtBounds;
  favoritesOnly?: boolean;
  // Callers still drop loaded cards with `keepVisible` for the ones the
  // `isHidden` backfill hasn't reached.
  includeHidden?: boolean;
  trash?: boolean;
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
  bounds?: CreatedAtBounds
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

const withCreatedAt = (
  range: DateBoundRange<"createdAt">,
  bounds?: CreatedAtBounds
) => withDateBounds(range, "createdAt", bounds);

export const buildCardListQuery = (
  ctx: QueryCtx,
  options: CardListQueryOptions
) => excludeHiddenRows(cardListIndexQuery(ctx, options), options.includeHidden);

const cardListIndexQuery = (ctx: QueryCtx, options: CardListQueryOptions) => {
  const { userId, createdAt } = options;
  const types = options.types?.length ? options.types : undefined;
  const singleType = types?.length === 1 ? types[0] : undefined;
  const cards = ctx.db.query("cards");
  const archived = archivedFilterMatch(options.archived, options.trash);

  if (archived === "any") {
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

export const buildHostCardListQuery = (
  ctx: QueryCtx,
  options: {
    archived?: "exclude" | "only";
    createdAt?: CreatedAtBounds;
    host: string;
    includeHidden?: boolean;
    userId: string;
  }
) =>
  excludeHiddenRows(
    ctx.db
      .query("cards")
      .withIndex("by_user_deleted_archived_host_created", (q) =>
        withCreatedAt(
          q
            .eq("userId", options.userId)
            .eq("isDeleted", undefined)
            .eq("isArchived", options.archived === "only" ? true : undefined)
            .eq("urlHost", options.host),
          options.createdAt
        )
      ),
    options.includeHidden
  );

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
  const withDates = (range: DateBoundRange<"cardCreatedAt">) =>
    withDateBounds(range, "cardCreatedAt", bounds);
  const isDeleted = options.trash ? (true as const) : undefined;
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

// Hidden cards are included: callers drop them with `keepVisible`.
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
  const withDates = (range: DateBoundRange<"cardCreatedAt">) =>
    withDateBounds(range, "cardCreatedAt", bounds);
  const isDeleted = options.trash ? (true as const) : undefined;
  const singleType = types?.length === 1 ? types[0] : undefined;
  const favorited = options.favoritesOnly === true;
  const anyArchived = archived === "any";
  const { userId, tag } = options;
  const tagRows = () => {
    const rows = ctx.db.query("cardSearchTags");
    if (anyArchived) {
      return rows.withIndex("by_user_tag_deleted_created", (q) =>
        withDates(
          q.eq("userId", userId).eq("tag", tag).eq("isDeleted", isDeleted)
        )
      );
    }
    if (singleType && favorited) {
      return rows.withIndex(
        "by_user_tag_deleted_archived_type_favorited_v2",
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
      return rows.withIndex("by_user_tag_deleted_archived_type_v2", (q) =>
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
      return rows.withIndex("by_user_tag_deleted_archived_favorited_v2", (q) =>
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
    return rows.withIndex("by_user_tag_deleted_archived_created_v2", (q) =>
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
