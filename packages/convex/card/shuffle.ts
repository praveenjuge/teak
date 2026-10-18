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

export const newShuffleKey = (): number => Math.random();

export interface ShuffleWalkOptions {
  archived?: ArchivedFilter;
  createdAt?: CreatedAtBounds;
  favoritesOnly?: boolean;
  includeHidden?: boolean;
  seed: number;
  trash?: boolean;
  types?: readonly CardType[];
  userId: string;
}

export interface ShuffleWalkPosition {
  page: string | null;
  segment: number;
}

const archiveStates = (options: ShuffleWalkOptions): (true | undefined)[] => {
  const match = archivedFilterMatch(options.archived, options.trash);
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
