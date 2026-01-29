import { memo, useCallback, useState } from "react";
import { Host, List, Section, Text, CircularProgress } from "@expo/ui/swift-ui";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
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
  const cards = useQuery(api.cards.searchCards, {
    searchQuery: searchQuery || undefined,
    types: selectedType ? [selectedType as any] : undefined,
    limit: 100,
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
  const description = searchQuery
    ? `No cards match "${searchQuery}"${selectedType ? ` in ${selectedType} cards` : ""}`
    : "Start by adding your first card";

  return (
    <Host useViewportSizeMeasurement style={{ flex: 1 }}>
      {cards === undefined ? (
        <CircularProgress />
      ) : cards.length === 0 ? (
        <List>
          <Section>
            <Text weight="semibold" color={colors.label as any}>
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
                key={card._id}
                card={card}
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
