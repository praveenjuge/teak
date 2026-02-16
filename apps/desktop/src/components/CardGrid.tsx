import type { MasonryProps } from "antd";
import { Masonry } from "antd";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Card, type DesktopCard } from "@/components/Card";
import { Spinner } from "@/components/ui/spinner";

type MasonryItem = NonNullable<MasonryProps<DesktopCard>["items"]>[number];

interface CardGridProps {
  cards: DesktopCard[];
  hasMore: boolean;
  isLoadingMore: boolean;
  onCardClick: (card: DesktopCard) => void;
  onLoadMore: () => void;
}

export function CardGrid({
  cards,
  hasMore,
  isLoadingMore,
  onCardClick,
  onLoadMore,
}: CardGridProps) {
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadRequestedRef = useRef(false);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    loadRequestedRef.current = false;
    if (!(sentinel && hasMore)) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          !entry?.isIntersecting ||
          loadRequestedRef.current ||
          isLoadingMore
        ) {
          return;
        }

        loadRequestedRef.current = true;
        onLoadMore();
      },
      { root: null, rootMargin: "200px 0px", threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  const masonryItems: MasonryItem[] = useMemo(
    () => cards.map((card) => ({ key: card._id, data: card })),
    [cards]
  );

  const renderItem = useCallback(
    (item: MasonryItem & { index: number }) => {
      return <Card card={item.data} onClick={onCardClick} />;
    },
    [onCardClick]
  );

  return (
    <>
      <Masonry
        columns={{ xs: 1, sm: 2, md: 3, lg: 4, xl: 5, xxl: 5 }}
        gutter={24}
        itemRender={renderItem}
        items={masonryItems}
      />

      {hasMore && (
        <div aria-hidden="true" className="h-10 w-full" ref={loadMoreRef} />
      )}

      {isLoadingMore && (
        <div className="flex justify-center py-6">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      )}
    </>
  );
}
