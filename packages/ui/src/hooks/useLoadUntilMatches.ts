import { useCallback, useEffect, useRef } from "react";

export type PaginationStatus =
  | "LoadingFirstPage"
  | "CanLoadMore"
  | "LoadingMore"
  | "Exhausted";

/**
 * Loads more of a paginated query whose pages can hold no match while more
 * remain (a filter applied after paging, such as colors in a folder):
 * whenever a requested page adds nothing, it asks for the next one, so the
 * list neither shows as empty nor stalls with matches further down.
 */
export function useLoadUntilMatches({
  count,
  loadMore,
  pageSize,
  status,
}: {
  count: number;
  loadMore: (pageSize: number) => void;
  pageSize: number;
  status: PaginationStatus;
}) {
  const countAtLoadMoreRef = useRef<number | null>(null);
  const requestMore = useCallback(() => {
    countAtLoadMoreRef.current = count;
    loadMore(pageSize);
  }, [count, loadMore, pageSize]);

  useEffect(() => {
    if (status !== "CanLoadMore") {
      return;
    }
    if (count === 0 || countAtLoadMoreRef.current === count) {
      requestMore();
    } else {
      countAtLoadMoreRef.current = null;
    }
  }, [count, status, requestMore]);

  return {
    /** Nothing matches yet, but later pages may. */
    isSeekingFirstMatch:
      count === 0 && (status === "CanLoadMore" || status === "LoadingMore"),
    requestMore,
  };
}
