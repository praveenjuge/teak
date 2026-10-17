import type { ExpressionOrValue } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CardType } from "../schema";
import { shuffleDescends, shuffleStart } from "../shared/search/shuffle";
import { excludeHiddenRows, keepVisible } from "./hiddenCards";
import {
  type ArchivedFilter,
  archivedFilterMatch,
  type CreatedAtBounds,
} from "./listQuery";

/** The Shuffle key a new card gets: uniform in [0, 1), never changed. */
export const newShuffleKey = (): number => Math.random();

export interface ShuffleWalkOptions {
  archived?: ArchivedFilter;
  createdAt?: CreatedAtBounds;
  favoritesOnly?: boolean;
  /** Hidden cards too: the search names a reserved tag. */
  includeHidden?: boolean;
  seed: number;
  trash?: boolean;
  types?: readonly CardType[];
  userId: string;
}

/**
 * Where a walk is: the segment it is reading and the page cursor inside it
 * (null at the segment's start).
 */
export interface ShuffleWalkPosition {
  page: string | null;
  segment: number;
}

const archiveStates = (options: ShuffleWalkOptions): (true | undefined)[] => {
  const match = archivedFilterMatch(options.archived, options.trash);
  return match === "any" ? [undefined, true] : [match];
};

/** How many segments a walk reads: two per archive state. */
export const shuffleSegmentCount = (options: ShuffleWalkOptions): number =>
  archiveStates(options).length * 2;

/**
 * One segment of the walk. Going up, a state's cards are read from the
 * seed's start point to the top (keys >= start), then from the bottom back
 * up to it (keys < start, cards without a key first); going down, the
 * other way round. Every card is read exactly once, whatever the seed.
 */
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
  const query = excludeHiddenRows(
    ctx.db.query("cards").withIndex("by_user_deleted_archived_shuffle", (q) => {
      const base = q
        .eq("userId", options.userId)
        .eq("isDeleted", options.trash ? true : undefined)
        .eq("isArchived", state);
      return upperRange
        ? base.gte("shuffleKey", start)
        : base.lt("shuffleKey", start);
    }),
    options.includeHidden
  ).order(descends ? "desc" : "asc");
  const types = options.types?.length ? options.types : undefined;
  const bounds = options.createdAt;
  const filtered =
    types ||
    options.favoritesOnly ||
    bounds?.gte !== undefined ||
    bounds?.lt !== undefined ||
    bounds?.lte !== undefined;
  if (!filtered) {
    return query;
  }
  return query.filter((q) => {
    const conditions: ExpressionOrValue<boolean>[] = [];
    if (types) {
      conditions.push(
        types
          .map((type) => q.eq(q.field("type"), type))
          .reduce((acc, condition) => q.or(acc, condition))
      );
    }
    if (options.favoritesOnly) {
      conditions.push(q.eq(q.field("isFavorited"), true));
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

/**
 * One page of the walk: up to `numItems` cards from the current segment.
 * A page never crosses into the next segment (a query can paginate once),
 * so it can come back short, or empty, with more still to read. Reads at
 * most `maximumRowsRead` rows when the filters skip many.
 */
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

/** A walk position as a page cursor, tied to the seed that started it. */
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

/**
 * The position in a cursor this walk issued for `seed`, the start for no
 * cursor, or null for any other cursor (another seed or sort, or garbage).
 */
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
