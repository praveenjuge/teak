import type {
  ExpressionOrValue,
  IndexRange,
  NamedTableInfo,
  Query,
} from "convex/server";
import type { DataModel, Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CardType } from "../schema";
import { shuffleDescends, shuffleStart } from "../shared/search/shuffle";
import { excludeHiddenRows, keepVisible } from "./hiddenCards";
import {
  type CardListScope,
  type CreatedAtBounds,
  scopeArchivedMatch,
  scopeDeletedMatch,
} from "./listQuery";

export const newShuffleKey = (): number => Math.random();

export interface ShuffleWalkOptions {
  createdAt?: CreatedAtBounds;
  favoritesOnly?: boolean;
  includeHidden?: boolean;
  scope?: CardListScope;
  seed: number;
  types?: readonly CardType[];
  userId: string;
}

export interface ShuffleWalkPosition {
  page: string | null;
  segment: number;
}

const archiveStates = (options: ShuffleWalkOptions): (true | undefined)[] => {
  const match = scopeArchivedMatch(options.scope);
  return match === "any" ? [undefined, true] : [match];
};

export const shuffleSegmentCount = (options: ShuffleWalkOptions): number =>
  archiveStates(options).length * 2;

export const buildShuffleSegmentQuery = (
  ctx: QueryCtx,
  options: ShuffleWalkOptions,
  segment: number
) => {
  const states = archiveStates(options);
  const state = states[Math.floor(segment / 2)];
  const start = shuffleStart(options.seed);
  const descends = shuffleDescends(options.seed);
  const firstHalf = segment % 2 === 0;
  const fromStart = firstHalf;
  const upperRange = descends ? !fromStart : fromStart;
  const types = options.types?.length
    ? Array.from(new Set(options.types))
    : undefined;
  const singleType = types?.length === 1 ? types[0] : undefined;
  const isDeleted = scopeDeletedMatch(options.scope);
  const cards = ctx.db.query("cards");
  const segmentOf = <
    Range extends {
      gte: (field: "shuffleKey", value: number) => IndexRange;
      lt: (field: "shuffleKey", value: number) => IndexRange;
    },
  >(
    range: Range
  ) =>
    upperRange ? range.gte("shuffleKey", start) : range.lt("shuffleKey", start);
  // A favourites or single-type walk reads an index of only those cards, so
  // its pages fill instead of spending the row budget on other cards.
  let indexed: Query<NamedTableInfo<DataModel, "cards">>;
  if (options.favoritesOnly) {
    indexed = cards.withIndex(
      "by_user_deleted_archived_favorited_shuffle",
      (q) =>
        segmentOf(
          q
            .eq("userId", options.userId)
            .eq("isDeleted", isDeleted)
            .eq("isArchived", state)
            .eq("isFavorited", true)
        )
    );
  } else if (singleType) {
    indexed = cards.withIndex("by_user_deleted_archived_type_shuffle", (q) =>
      segmentOf(
        q
          .eq("userId", options.userId)
          .eq("isDeleted", isDeleted)
          .eq("isArchived", state)
          .eq("type", singleType)
      )
    );
  } else {
    indexed = cards.withIndex("by_user_deleted_archived_shuffle", (q) =>
      segmentOf(
        q
          .eq("userId", options.userId)
          .eq("isDeleted", isDeleted)
          .eq("isArchived", state)
      )
    );
  }
  const query = excludeHiddenRows(indexed, options.includeHidden).order(
    descends ? "desc" : "asc"
  );
  const filteredTypes =
    options.favoritesOnly || !singleType ? types : undefined;
  const bounds = options.createdAt;
  const filtered =
    filteredTypes ||
    bounds?.gte !== undefined ||
    bounds?.lt !== undefined ||
    bounds?.lte !== undefined;
  if (!filtered) {
    return query;
  }
  return query.filter((q) => {
    const conditions: ExpressionOrValue<boolean>[] = [];
    if (filteredTypes) {
      conditions.push(
        filteredTypes
          .map((type) => q.eq(q.field("type"), type))
          .reduce((acc, condition) => q.or(acc, condition))
      );
    }
    if (bounds?.gte !== undefined) {
      conditions.push(q.gte(q.field("createdAt"), bounds.gte));
    }
    if (bounds?.lte !== undefined) {
      conditions.push(q.lte(q.field("createdAt"), bounds.lte));
    } else if (bounds?.lt !== undefined) {
      conditions.push(q.lt(q.field("createdAt"), bounds.lt));
    }
    return conditions.reduce((acc, condition) => q.and(acc, condition));
  });
};

// A Convex query can paginate once, so a page stays inside one segment and
// can come back short, or empty, with more still to read.
export const pageShuffleWalk = async (
  ctx: QueryCtx,
  options: ShuffleWalkOptions,
  position: ShuffleWalkPosition,
  limits: { maximumRowsRead?: number; numItems: number }
): Promise<{
  cards: Doc<"cards">[];
  next: ShuffleWalkPosition | null;
}> => {
  const segments = shuffleSegmentCount(options);
  if (position.segment >= segments) {
    return { cards: [], next: null };
  }
  const result = await buildShuffleSegmentQuery(
    ctx,
    options,
    position.segment
  ).paginate({
    cursor: position.page,
    numItems: limits.numItems,
    ...(limits.maximumRowsRead
      ? { maximumRowsRead: limits.maximumRowsRead }
      : {}),
  });
  let next: ShuffleWalkPosition | null;
  if (!result.isDone) {
    next = { segment: position.segment, page: result.continueCursor };
  } else if (position.segment + 1 < segments) {
    next = { segment: position.segment + 1, page: null };
  } else {
    next = null;
  }
  return { cards: keepVisible(result.page, options.includeHidden), next };
};

const WALK_CURSOR_VERSION = 1;

export const encodeShuffleWalkCursor = (
  seed: number,
  position: ShuffleWalkPosition
): string =>
  JSON.stringify({
    v: WALK_CURSOR_VERSION,
    seed,
    segment: position.segment,
    page: position.page,
  });

export const decodeShuffleWalkCursor = (
  seed: number,
  cursor: string | null | undefined
): ShuffleWalkPosition | null => {
  if (!cursor) {
    return { segment: 0, page: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.v !== WALK_CURSOR_VERSION ||
    value.seed !== seed ||
    !(
      typeof value.segment === "number" &&
      Number.isInteger(value.segment) &&
      value.segment >= 0 &&
      value.segment < 4
    ) ||
    !(value.page === null || typeof value.page === "string")
  ) {
    return null;
  }
  return { segment: value.segment, page: value.page };
};
