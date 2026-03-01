import {
  ContentUnavailableView,
  Host,
  HStack,
  List,
  ProgressView,
  Spacer,
  VStack,
} from "@expo/ui/swift-ui";
import { listStyle, onAppear, refreshable } from "@expo/ui/swift-ui/modifiers";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { parseTimeSearchQuery } from "@teak/convex/shared";
import { useConvex, usePaginatedQuery } from "convex/react";
import { Link } from "expo-router";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { triggerCardTapHaptic } from "@/lib/haptics";
import { useCardActions } from "@/lib/hooks/useCardActionsMobile";
import { CardItem } from "./CardItem";

type Card = Doc<"cards"> & {
  fileUrl?: string;
  screenshotUrl?: string;
  thumbnailUrl?: string;
};

interface CardsGridProps {
  searchQuery?: string;
  selectedType?: string;
}

interface SearchCardsPaginatedArgs {
  createdAtRange?: {
    end: number;
    start: number;
  };
  searchQuery?: string;
  types?: string[];
}

const PAGE_SIZE = 20;
const AUTO_LOAD_THRESHOLD_FROM_END = 5;

interface PaginatedCardsListProps {
  description: string;
  emptyIcon: string;
  emptyTitle: string;
  onRefresh: () => Promise<void>;
  queryArgs: SearchCardsPaginatedArgs;
}

function PaginatedCardsList({
  description,
  emptyIcon,
  emptyTitle,
  onRefresh,
  queryArgs,
}: PaginatedCardsListProps) {
  const cardActions = useCardActions();
  const { loadMore, results, status } = usePaginatedQuery(
    api.cards.searchCardsPaginated,
    queryArgs,
    { initialNumItems: PAGE_SIZE }
  );

  const handleCardTap = useCallback(() => {
    void triggerCardTapHaptic();
  }, []);

  const isLoadingFirstPage = status === "LoadingFirstPage";
  const isLoadingMore = status === "LoadingMore";
  const canLoadMore = status === "CanLoadMore";
  const lastAutoLoadAtCount = useRef<number | null>(null);

  const handleAutoLoadMore = useCallback(() => {
    if (!canLoadMore) {
      return;
    }

    if (lastAutoLoadAtCount.current === results.length) {
      return;
    }

    lastAutoLoadAtCount.current = results.length;
    loadMore(PAGE_SIZE);
  }, [canLoadMore, loadMore, results.length]);

  if (isLoadingFirstPage && results.length === 0) {
    return (
      <VStack alignment="center" spacing={16}>
        <Spacer />
        <HStack alignment="center" spacing={0}>
          <Spacer />
          <ProgressView />
          <Spacer />
        </HStack>
        <Spacer />
      </VStack>
    );
  }

  if (results.length === 0) {
    return (
      <ContentUnavailableView
        description={description}
        systemImage={emptyIcon as any}
        title={emptyTitle}
      />
    );
  }

  return (
    <List modifiers={[listStyle("plain"), refreshable(onRefresh)]}>
      <List.ForEach>
        {results.map((card: Card, index) => {
          const isNearBottom =
            index >= Math.max(0, results.length - AUTO_LOAD_THRESHOLD_FROM_END);

          return (
            <VStack
              key={card._id}
              modifiers={isNearBottom ? [onAppear(handleAutoLoadMore)] : []}
            >
              <Link
                asChild
                href={{
                  params: { id: card._id },
                  pathname: "/(tabs)/(home)/card/[id]",
                }}
              >
                <CardItem
                  card={card}
                  onDeleteRequest={() =>
                    void cardActions.handleDeleteCard(card._id)
                  }
                  onPress={handleCardTap}
                />
              </Link>
            </VStack>
          );
        })}
      </List.ForEach>

      {isLoadingMore ? (
        <HStack alignment="center" spacing={8}>
          <Spacer />
          <ProgressView />
          <Spacer />
        </HStack>
      ) : null}
    </List>
  );
}

const CardsGrid = memo(function CardsGrid({
  searchQuery,
  selectedType,
}: CardsGridProps) {
  const convex = useConvex();
  const [refreshVersion, setRefreshVersion] = useState(0);

  const timeFilter = useMemo(() => {
    if (!searchQuery?.trim()) {
      return null;
    }

    return parseTimeSearchQuery(searchQuery, { now: new Date(), weekStart: 0 });
  }, [searchQuery]);

  const effectiveSearchQuery = timeFilter
    ? undefined
    : searchQuery || undefined;
  const queryArgs = useMemo(
    () => ({
      createdAtRange: timeFilter?.range,
      searchQuery: effectiveSearchQuery,
      types: selectedType ? [selectedType] : undefined,
    }),
    [effectiveSearchQuery, selectedType, timeFilter?.range]
  );

  const queryKey = useMemo(
    () => JSON.stringify({ queryArgs, refreshVersion }),
    [queryArgs, refreshVersion]
  );

  const handleRefresh = useCallback(async () => {
    await convex.query(api.cards.searchCardsPaginated, {
      ...queryArgs,
      paginationOpts: { cursor: null, numItems: PAGE_SIZE },
    });
    setRefreshVersion((value) => value + 1);
  }, [convex, queryArgs]);

  const emptyTitle = searchQuery ? "No cards found" : "No cards yet";
  const description = timeFilter
    ? `No cards from ${timeFilter.label}`
    : searchQuery
      ? `No cards match "${searchQuery}"${selectedType ? ` in ${selectedType} cards` : ""}`
      : "Start by adding your first card";
  const emptyIcon =
    searchQuery || timeFilter ? "magnifyingglass" : "plus.circle";

  return (
    <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
      <PaginatedCardsList
        description={description}
        emptyIcon={emptyIcon}
        emptyTitle={emptyTitle}
        key={queryKey}
        onRefresh={handleRefresh}
        queryArgs={queryArgs}
      />
    </Host>
  );
});

export { CardsGrid };
