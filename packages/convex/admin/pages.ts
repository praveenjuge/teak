import type { PaginationResult } from "convex/server";
import type { QueryCtx } from "../_generated/server";

const USER_PAGE = 1000;
const CARD_PAGE = 500;
const CARD_PAGE_BYTES = 4 * 1024 * 1024;

/** One page of an admin read, as a query returns it to its action. */
export interface Page<T> {
  continueCursor: string;
  isDone: boolean;
  rows: T[];
}

export const toPage = <T>(
  result: Pick<PaginationResult<unknown>, "continueCursor" | "isDone">,
  rows: T[]
): Page<T> => ({
  rows,
  isDone: result.isDone,
  continueCursor: result.continueCursor,
});

/** Accounts created at or after `since`, oldest first. */
export const pageUsersCreated = (
  ctx: Pick<QueryCtx, "db">,
  cursor: string | null,
  since = 0
) =>
  ctx.db
    .query("users")
    .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
    .paginate({ cursor, numItems: USER_PAGE });

/** Cards created in `[since, until)`, oldest first. */
export const pageCardsCreated = (
  ctx: Pick<QueryCtx, "db">,
  cursor: string | null,
  { since = 0, until }: { since?: number; until?: number }
) =>
  ctx.db
    .query("cards")
    .withIndex("by_creation_time", (q) => {
      const from = q.gte("_creationTime", since);
      return until === undefined ? from : from.lt("_creationTime", until);
    })
    .paginate({
      cursor,
      numItems: CARD_PAGE,
      maximumBytesRead: CARD_PAGE_BYTES,
    });

/**
 * Reads page after page from an action until the last one, or `maxPages`;
 * `isComplete` says whether it got to the end.
 */
export const readAllPages = async <T>(
  readPage: (cursor: string | null) => Promise<Page<T>>,
  maxPages: number
): Promise<{ rows: T[]; isComplete: boolean }> => {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await readPage(cursor);
    rows.push(...result.rows);
    if (result.isDone) {
      return { rows, isComplete: true };
    }
    cursor = result.continueCursor;
  }
  return { rows, isComplete: false };
};
