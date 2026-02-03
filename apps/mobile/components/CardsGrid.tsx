import { CircularProgress, Host, List, Section, Text } from "@expo/ui/swift-ui";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { parseTimeSearchQuery } from "@teak/convex/shared";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { memo, useCallback, useMemo, useState } from "react";
import { colors } from "../constants/colors";
import { CardItem } from "./CardItem";
import { CardPreviewSheet } from "./CardPreviewSheet";

type Card = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
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
  const cards = useQuery(api.cards.searchCards, {
    searchQuery: effectiveSearchQuery,
    types: selectedType ? [selectedType as any] : undefined,
    limit: 100,
    createdAtRange: timeFilter?.range,
  });
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const handleCardPress = useCallback((card: Card) => {
    setSelectedCard(card);
    setIsSheetOpen(true);
  }, []);

  const handleSheetClose = useCallback(() => {
    setIsSheetOpen(false);
  }, []);

  const emptyTitle = searchQuery ? "No cards found" : "No cards yet";
  const description = timeFilter
    ? `No cards from ${timeFilter.label}`
    : searchQuery
      ? `No cards match "${searchQuery}"${selectedType ? ` in ${selectedType} cards` : ""}`
      : "Start by adding your first card";

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      {cards === undefined ? (
        <CircularProgress />
      ) : cards.length === 0 ? (
        <List>
          <Section>
            <Text color={colors.label as any} weight="semibold">
              {emptyTitle}
            </Text>
            <Text color={colors.secondaryLabel as any} lineLimit={3}>
              {description}
            </Text>
          </Section>
        </List>
      ) : (
        <>
          <List listStyle="plain">
            {cards.map((card: Card) => (
              <CardItem
                card={card}
                key={card._id}
                onPress={() => handleCardPress(card)}
              />
            ))}
          </List>
          <CardPreviewSheet
            card={selectedCard}
            isOpen={isSheetOpen}
            onClose={handleSheetClose}
          />
        </>
      )}
    </Host>
  );
});

export { CardsGrid };
