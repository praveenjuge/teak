import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { ShuffleWalkPosition } from "./card/shuffle";
import type { TombstoneCursor } from "./publicApiTombstones";
import { shuffleRank } from "./shared/search/shuffle";

export interface ListAnchor {
  createdAt: number;
  creationTime: number;
}

export interface MatchAnchor {
  createdAt: number;
  id: string;
}

export type ApiCursor =
  | { mode: "start" }
  | { mode: "list"; anchor?: ListAnchor; page?: string }
  | { mode: "match"; anchor: MatchAnchor }
  | { mode: "relevance"; offset: number; ranked: boolean };

export const invalidCursorError = () =>
  new ConvexError({
    code: "INVALID_INPUT",
    message: "Query parameter `cursor` is invalid",
  });

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const encodeCursor = (cursor: ApiCursor): string =>
  btoa(JSON.stringify(cursor));

export const decodeCursor = (cursor?: string): ApiCursor => {
  if (!cursor) {
    return { mode: "start" };
  }

  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(atob(cursor));
  } catch {
    throw invalidCursorError();
  }
  if (!parsed || typeof parsed !== "object") {
    throw invalidCursorError();
  }

  switch (parsed.mode) {
    case "list": {
      const anchor = parsed.anchor as Record<string, unknown> | undefined;
      const page = parsed.page;
      if (
        (anchor !== undefined &&
          !(
            isFiniteNumber(anchor?.createdAt) &&
            isFiniteNumber(anchor.creationTime)
          )) ||
        (page !== undefined && typeof page !== "string")
      ) {
        break;
      }
      return {
        mode: "list",
        ...(anchor
          ? {
              anchor: {
                createdAt: anchor.createdAt as number,
                creationTime: anchor.creationTime as number,
              },
            }
          : {}),
        ...(typeof page === "string" ? { page } : {}),
      };
    }
    case "match": {
      const anchor = parsed.anchor as Record<string, unknown> | undefined;
      if (isFiniteNumber(anchor?.createdAt) && typeof anchor.id === "string") {
        return {
          mode: "match",
          anchor: { createdAt: anchor.createdAt, id: anchor.id },
        };
      }
      break;
    }
    case "relevance":
      if (isFiniteNumber(parsed.offset) && typeof parsed.ranked === "boolean") {
        return {
          mode: "relevance",
          offset: Math.max(0, Math.floor(parsed.offset)),
          ranked: parsed.ranked,
        };
      }
      break;
    default:
      break;
  }
  throw invalidCursorError();
};

export const matchAnchorOf = (card: Doc<"cards">): MatchAnchor => ({
  createdAt: card.createdAt,
  id: String(card._id),
});

export const listAnchorOf = (card: Doc<"cards">): ListAnchor => ({
  createdAt: card.createdAt,
  creationTime: card._creationTime,
});

export const relevanceCursorRanked = (
  cursor: string | undefined
): boolean | undefined => {
  if (!cursor) {
    return;
  }
  try {
    const decoded = decodeCursor(cursor);
    return decoded.mode === "relevance" ? decoded.ranked : undefined;
  } catch {
    return undefined;
  }
};

export type ShuffleApiCursor =
  | { mode: "start" }
  | { mode: "walk"; position: ShuffleWalkPosition }
  | { mode: "after"; rank: number; id: string };

export const encodeShuffleCursor = (
  seed: number,
  cursor: Exclude<ShuffleApiCursor, { mode: "start" }>
): string =>
  btoa(
    JSON.stringify(
      cursor.mode === "walk"
        ? { mode: "shuffle", seed, position: cursor.position }
        : { mode: "shuffle", seed, rank: cursor.rank, id: cursor.id }
    )
  );

export const decodeShuffleCursor = (
  seed: number,
  cursor: string | undefined
): ShuffleApiCursor => {
  if (!cursor) {
    return { mode: "start" };
  }
  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(atob(cursor));
  } catch {
    throw invalidCursorError();
  }
  if (parsed?.mode !== "shuffle" || parsed.seed !== seed) {
    throw invalidCursorError();
  }
  if (parsed.position && typeof parsed.position === "object") {
    const position = parsed.position as Record<string, unknown>;
    if (
      typeof position.segment === "number" &&
      Number.isInteger(position.segment) &&
      position.segment >= 0 &&
      (position.page === null || typeof position.page === "string")
    ) {
      return {
        mode: "walk",
        position: { segment: position.segment, page: position.page },
      };
    }
  }
  if (isFiniteNumber(parsed.rank) && typeof parsed.id === "string") {
    return { mode: "after", rank: parsed.rank, id: parsed.id };
  }
  throw invalidCursorError();
};

export const isAfterShuffleAnchor = (
  seed: number,
  id: string,
  anchor: { rank: number; id: string }
) => {
  const rank = shuffleRank(seed, id);
  return rank > anchor.rank || (rank === anchor.rank && id > anchor.id);
};

export type ChangesCursor =
  | { phase: "cards"; cursor: string | null }
  | { phase: "tombstones"; after?: TombstoneCursor };

export const encodeChangesCursor = (cursor: ChangesCursor): string =>
  btoa(JSON.stringify({ v: 2, ...cursor }));

export const decodeChangesCursor = (cursor?: string): ChangesCursor => {
  if (!cursor) {
    return { phase: "cards", cursor: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(cursor));
  } catch {
    throw invalidCursorError();
  }
  const value = parsed as Record<string, unknown> | null;
  if (value?.v !== 2) {
    throw invalidCursorError();
  }
  if (
    value.phase === "cards" &&
    (value.cursor === null || typeof value.cursor === "string")
  ) {
    return { phase: "cards", cursor: value.cursor };
  }
  if (value.phase === "tombstones") {
    const after = value.after as Record<string, unknown> | undefined;
    if (after === undefined) {
      return { phase: "tombstones" };
    }
    if (
      typeof after?.deletedAt === "number" &&
      typeof after.creationTime === "number"
    ) {
      return {
        phase: "tombstones",
        after: {
          creationTime: after.creationTime,
          deletedAt: after.deletedAt,
        },
      };
    }
  }
  throw invalidCursorError();
};
