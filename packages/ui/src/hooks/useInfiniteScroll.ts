import { useEffect, useRef } from "react";

export interface UseInfiniteScrollOptions {
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
  threshold?: number;
}

export function useInfiniteScroll({
  hasMore,
  isLoading,
  onLoadMore,
  rootMargin = "200px 0px",
  threshold = 0,
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadRequestedRef = useRef(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    loadRequestedRef.current = false;

    if (!(sentinel && hasMore)) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || loadRequestedRef.current || isLoading) {
          return;
        }

        loadRequestedRef.current = true;
        onLoadMore();
      },
      { root: null, rootMargin, threshold }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore, rootMargin, threshold]);

  return sentinelRef;
}
