import {
  Host,
  HStack,
  List,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  lineLimit,
  listStyle,
} from "@expo/ui/swift-ui/modifiers";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { parseTimeSearchQuery } from "@teak/convex/shared";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useRouter } from "expo-router";
import { memo, useCallback, useMemo } from "react";
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
  const cards = useQuery(api.cards.searchCards, {
    createdAtRange: timeFilter?.range,
    limit: 100,
    searchQuery: effectiveSearchQuery,
    types: selectedType ? [selectedType as any] : undefined,
  });

  const cardActions = useCardActions();
  const router = useRouter();

  const handleCardPress = useCallback(
    (card: Card) => {
      router.push({
        params: { id: card._id },
        pathname: "/(tabs)/(home)/card/[id]",
      });
    },
    [router]
  );

  const emptyTitle = searchQuery ? "No cards found" : "No cards yet";
  const description = timeFilter
    ? `No cards from ${timeFilter.label}`
    : searchQuery
      ? `No cards match "${searchQuery}"${selectedType ? ` in ${selectedType} cards` : ""}`
      : "Start by adding your first card";

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
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
        <List>
          <Section>
            <Text modifiers={[font({ weight: "semibold" })]}>{emptyTitle}</Text>
            <Text
              modifiers={[
                foregroundStyle({ type: "hierarchical", style: "secondary" }),
                lineLimit(3),
              ]}
            >
              {description}
            </Text>
          </Section>
        </List>
      ) : (
        <List modifiers={[listStyle("plain")]}>
          {cards.map((card: Card) => (
            <CardItem
              card={card}
              key={card._id}
              onDeleteRequest={() =>
                void cardActions.handleDeleteCard(card._id)
              }
              onPress={() => handleCardPress(card)}
            />
          ))}
        </List>
      )}
    </Host>
  );
});

export { CardsGrid };
