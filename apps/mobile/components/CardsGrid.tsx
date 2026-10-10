import {
  Button,
  ContentUnavailableView,
  Host,
  HStack,
  LazyVStack,
  ProgressView,
  RNHostView,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  background,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  onAppear,
  padding,
  refreshable,
} from "@expo/ui/swift-ui/modifiers";
import { api } from "@teak/convex";
import { parseTimeSearchQuery } from "@teak/convex/shared";
import { useConvex, usePaginatedQuery } from "convex/react";
import { Link, useRouter } from "expo-router";
import { memo, useCallback, useMemo, useRef } from "react";
import { Alert, PlatformColor, useWindowDimensions } from "react-native";
import Logo from "@/components/Logo";
import {
  distributeIntoColumns,
  estimateTileHeight,
  GRID_EDGE,
  GRID_GAP,
  getGridColumnCount,
  getGridColumnWidth,
} from "@/lib/card-grid";
import { triggerCardTapHaptic } from "@/lib/haptics";
import { useCardActions } from "@/lib/hooks/useCardActionsMobile";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  type LibraryFilters,
  toSearchArgs,
} from "@/lib/library-filters";
import {
  type MobileCardSummary,
  rememberMobileCardSummary,
} from "@/lib/mobile-card-summary-cache";
import { useThemePreference } from "@/lib/theme-preference";
import { CardItem } from "./CardItem";

interface CardSelection {
  ids: ReadonlySet<string>;
  onToggle: (cardId: string) => void;
}

interface CardsGridProps {
  filters?: LibraryFilters;
  /** Starts selection with a card, from its context menu. */
  onBeginSelection?: (cardId: string) => void;
  searchQuery?: string;
  /** Present while selecting; taps then toggle cards instead of opening them. */
  selection?: CardSelection | null;
}

interface SearchCardsPaginatedArgs {
  createdAtRange?: {
    end: number;
    start: number;
  };
  favoritesOnly?: boolean;
  hueFilters?: string[];
  searchQuery?: string;
  showTrashOnly?: boolean;
  types?: string[];
}

const PAGE_SIZE = 20;
const AUTO_LOAD_THRESHOLD_FROM_END = 5;

interface PaginatedCardsListProps {
  description: string;
  emptyIcon: string;
  emptyTitle: string;
  isSearching: boolean;
  onBeginSelection?: (cardId: string) => void;
  onRefresh: () => Promise<void>;
  queryArgs: SearchCardsPaginatedArgs;
  selection?: CardSelection | null;
}

const pageBackground = PlatformColor("systemGroupedBackground");

/** Mirrors the web's first-run state: the wordmark, a prompt, and one action. */
function EmptyLibrary() {
  const router = useRouter();
  const { resolvedScheme } = useThemePreference();

  return (
    <VStack
      alignment="center"
      modifiers={[
        frame({ maxWidth: 10_000, maxHeight: 10_000 }),
        padding({ horizontal: 40 }),
      ]}
      spacing={20}
    >
      <RNHostView matchContents>
        <Logo
          color={resolvedScheme === "dark" ? "#ffffff" : "#111111"}
          height={23}
          width={72}
        />
      </RNHostView>
      <VStack alignment="center" spacing={6}>
        <Text
          modifiers={[
            font({ design: "rounded", size: 17, weight: "semibold" }),
          ]}
        >
          Let's add your first card!
        </Text>
        <Text
          modifiers={[
            font({ design: "rounded", size: 15 }),
            foregroundStyle({ type: "hierarchical", style: "secondary" }),
            multilineTextAlignment("center"),
          ]}
        >
          Save notes, links, photos, and voice memos. They'll show up here.
        </Text>
      </VStack>
      <Button
        label="Write a Note"
        modifiers={[buttonStyle("glassProminent"), controlSize("large")]}
        onPress={() => router.push("/(tabs)/add/text")}
        systemImage="square.and.pencil"
      />
    </VStack>
  );
}

function PaginatedCardsList({
  description,
  emptyIcon,
  emptyTitle,
  isSearching,
  onBeginSelection,
  onRefresh,
  queryArgs,
  selection,
}: PaginatedCardsListProps) {
  const { width: windowWidth } = useWindowDimensions();
  const columnCount = getGridColumnCount(windowWidth);
  const columnWidth = getGridColumnWidth(windowWidth, columnCount);
  const cardActions = useCardActions();
  const { loadMore, results, status } = usePaginatedQuery(
    api.cards.searchMobileCardSummariesPaginated,
    queryArgs,
    { initialNumItems: PAGE_SIZE }
  );

  const handleCardTap = useCallback((card: MobileCardSummary) => {
    rememberMobileCardSummary(card);
    void triggerCardTapHaptic();
  }, []);

  const confirmDeleteForever = useCallback(
    (cardId: MobileCardSummary["_id"]) => {
      Alert.alert(
        "Delete Forever?",
        "This removes the card and its files. You can't undo it.",
        [
          { style: "cancel", text: "Cancel" },
          {
            onPress: () => void cardActions.handlePermanentDeleteCard(cardId),
            style: "destructive",
            text: "Delete Forever",
          },
        ]
      );
    },
    [cardActions]
  );
  const inTrash = Boolean(queryArgs.showTrashOnly);

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
    return isSearching ? (
      <ContentUnavailableView
        description={description}
        systemImage={emptyIcon as any}
        title={emptyTitle}
      />
    ) : (
      <EmptyLibrary />
    );
  }

  const nearEndIds = new Set(
    results
      .slice(Math.max(0, results.length - AUTO_LOAD_THRESHOLD_FROM_END))
      .map((card) => card._id)
  );
  const columns = distributeIntoColumns(results, columnCount, (card) =>
    estimateTileHeight(card, columnWidth)
  );

  return (
    <ScrollView
      modifiers={[
        refreshable(onRefresh),
        background(pageBackground, { ignoresSafeAreaEdges: "all" }),
      ]}
    >
      <HStack
        alignment="top"
        modifiers={[padding({ horizontal: GRID_EDGE, top: 8, bottom: 24 })]}
        spacing={GRID_GAP}
      >
        {columns.map((column, columnIndex) => (
          <LazyVStack
            // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
            key={columnIndex}
            modifiers={[frame({ width: columnWidth })]}
            spacing={GRID_GAP}
          >
            {column.map((card) => (
              <VStack
                key={card._id}
                modifiers={
                  nearEndIds.has(card._id) ? [onAppear(handleAutoLoadMore)] : []
                }
              >
                {selection ? (
                  <CardItem
                    card={card}
                    isSelected={selection.ids.has(card._id)}
                    onPress={() => {
                      void triggerCardTapHaptic();
                      selection.onToggle(card._id);
                    }}
                    width={columnWidth}
                  />
                ) : (
                  <Link
                    asChild
                    href={{
                      params: { id: card._id },
                      pathname: "/(tabs)/(home)/card/[id]",
                    }}
                  >
                    <CardItem
                      card={card}
                      inTrash={inTrash}
                      onDeleteForeverRequest={() =>
                        confirmDeleteForever(card._id)
                      }
                      onDeleteRequest={() =>
                        void cardActions.handleDeleteCard(card._id)
                      }
                      onPress={() => handleCardTap(card)}
                      onRestoreRequest={() =>
                        void cardActions.handleRestoreCard(card._id)
                      }
                      onSelectRequest={() => onBeginSelection?.(card._id)}
                      width={columnWidth}
                    />
                  </Link>
                )}
              </VStack>
            ))}
          </LazyVStack>
        ))}
      </HStack>

      {isLoadingMore ? (
        <HStack alignment="center" modifiers={[padding({ bottom: 24 })]}>
          <Spacer />
          <ProgressView />
          <Spacer />
        </HStack>
      ) : null}
    </ScrollView>
  );
}

const CardsGrid = memo(function CardsGrid({
  filters = EMPTY_FILTERS,
  onBeginSelection,
  searchQuery,
  selection,
}: CardsGridProps) {
  const convex = useConvex();

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
      ...toSearchArgs(filters),
    }),
    [effectiveSearchQuery, filters, timeFilter?.range]
  );

  const handleRefresh = useCallback(async () => {
    await convex.query(api.cards.searchMobileCardSummariesPaginated, {
      ...queryArgs,
      paginationOpts: { cursor: null, numItems: PAGE_SIZE },
    });
  }, [convex, queryArgs]);

  // Matches the system search empty state wording.
  let emptyTitle = searchQuery
    ? `No Results for \u201C${searchQuery}\u201D`
    : "No Matching Cards";
  let description = timeFilter
    ? `No cards from ${timeFilter.label}.`
    : "Check the spelling or try a new search.";
  let emptyIcon = "magnifyingglass";
  if (!searchQuery && filters.trashOnly) {
    emptyTitle = "Trash Is Empty";
    description = "Cards you delete stay here for 30 days.";
    emptyIcon = "trash";
  } else if (!searchQuery && hasActiveFilters(filters)) {
    description = "Try other filters.";
    emptyIcon = "line.3.horizontal.decrease.circle";
  }

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <PaginatedCardsList
        description={description}
        emptyIcon={emptyIcon}
        emptyTitle={emptyTitle}
        isSearching={Boolean(searchQuery) || hasActiveFilters(filters)}
        onBeginSelection={onBeginSelection}
        onRefresh={handleRefresh}
        queryArgs={queryArgs}
        selection={selection}
      />
    </Host>
  );
});

export { CardsGrid };
