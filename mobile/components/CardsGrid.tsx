import { memo } from "react";
import { Host, List, Section, Text, CircularProgress } from "@expo/ui/swift-ui";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
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
        <List listStyle="plain">
          {cards.map((card: Card) => (
            <CardItem key={card._id} card={card} />
          ))}
        </List>
      )}
    </Host>
  );
});

export { CardsGrid };
