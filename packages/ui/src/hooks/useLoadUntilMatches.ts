import { useCallback, useEffect, useRef } from "react";

export type PaginationStatus =
  | "LoadingFirstPage"
  | "CanLoadMore"
  | "LoadingMore"
  | "Exhausted";

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
    isSeekingFirstMatch:
      count === 0 && (status === "CanLoadMore" || status === "LoadingMore"),
    requestMore,
  };
}
