import { memo, useCallback } from "react";
import { Alert } from "react-native";
import { Host, List, Section, Text } from "@expo/ui/swift-ui";
import { useQuery } from "convex/react";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { useCardActions } from "@/lib/hooks/useCardActionsMobile";
import { colors } from "../constants/colors";
import { CardItem } from "./CardItem";

type Card = Doc<"cards">;

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

  const cardActions = useCardActions();

  const handleDeleteItem = useCallback(
    (index: number) => {
      if (!cards || !cards[index]) return;

      Alert.alert("Delete Card", "Delete this card?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void cardActions.handleDeleteCard(cards[index]._id);
          },
        },
      ]);
    },
    [cards, cardActions]
  );

  if (cards === undefined) {
    return (
      <Host matchContents useViewportSizeMeasurement>
        <List scrollEnabled={false} listStyle="insetGrouped">
          <Text color={colors.secondaryLabel as any}>Loading cards...</Text>
        </List>
      </Host>
    );
  }

  if (cards.length === 0) {
    const emptyTitle = searchQuery ? "No cards found" : "No cards yet";
    const description = searchQuery
      ? `No cards match "${searchQuery}"${selectedType ? ` in ${selectedType} cards` : ""}`
      : "Start by adding your first card";

    return (
      <Host matchContents useViewportSizeMeasurement>
        <List scrollEnabled={false} listStyle="insetGrouped">
          <Section>
            <Text weight="semibold" color={colors.label as any}>
              {emptyTitle}
            </Text>
            <Text color={colors.secondaryLabel as any} lineLimit={3}>
              {description}
            </Text>
          </Section>
        </List>
      </Host>
    );
  }

  return (
    <Host matchContents useViewportSizeMeasurement>
      <List
        listStyle="insetGrouped"
        scrollEnabled={true}
        deleteEnabled
        onDeleteItem={handleDeleteItem}
      >
        {cards.map((card: Card) => (
          <CardItem key={card._id} card={card} />
        ))}
      </List>
    </Host>
  );
});

export { CardsGrid };
