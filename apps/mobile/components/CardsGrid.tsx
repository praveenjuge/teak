import {
  ContentUnavailableView,
  Host,
  HStack,
  List,
  ProgressView,
  Spacer,
  VStack,
} from "@expo/ui/swift-ui";
import { listStyle, refreshable } from "@expo/ui/swift-ui/modifiers";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { parseTimeSearchQuery } from "@teak/convex/shared";
import { useConvex } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { Link } from "expo-router";
import { memo, useCallback, useMemo } from "react";
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

const CardsGrid = memo(function CardsGrid({
  searchQuery,
  selectedType,
}: CardsGridProps) {
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
      limit: 100,
      searchQuery: effectiveSearchQuery,
      types: selectedType ? [selectedType as any] : undefined,
    }),
    [effectiveSearchQuery, selectedType, timeFilter?.range]
  );
  const cards = useQuery(api.cards.searchCards, queryArgs);
  const convex = useConvex();
  const cardActions = useCardActions();

  const handleRefresh = useCallback(async () => {
    await convex.query(api.cards.searchCards, queryArgs);
  }, [convex, queryArgs]);

  const handleCardTap = useCallback(() => {
    void triggerCardTapHaptic();
  }, []);

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
      {cards === undefined ? (
        <VStack alignment="center" spacing={16}>
          <Spacer />
          <HStack alignment="center" spacing={0}>
            <Spacer />
            <ProgressView />
            <Spacer />
          </HStack>
          <Spacer />
        </VStack>
      ) : cards.length === 0 ? (
        <ContentUnavailableView
          description={description}
          systemImage={emptyIcon as any}
          title={emptyTitle}
        />
      ) : (
        <List modifiers={[listStyle("plain"), refreshable(handleRefresh)]}>
          <List.ForEach>
            {cards.map((card: Card) => (
              <Link
                asChild
                href={{
                  params: { id: card._id },
                  pathname: "/(tabs)/(home)/card/[id]",
                }}
                key={card._id}
              >
                <CardItem
                  card={card}
                  onDeleteRequest={() =>
                    void cardActions.handleDeleteCard(card._id)
                  }
                  onPress={handleCardTap}
                />
              </Link>
            ))}
          </List.ForEach>
        </List>
      )}
    </Host>
  );
});

export { CardsGrid };
