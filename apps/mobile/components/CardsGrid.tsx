import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery } from "convex/react";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { colors } from "../constants/colors";
import { CardItem } from "./CardItem";

type Card = Doc<"cards">;

// Define props interface locally
interface CardsGridProps {
  searchQuery?: string;
  selectedType?: string;
}

export function CardsGrid({ searchQuery, selectedType }: CardsGridProps) {
  // Use Convex query directly
  const cards = useQuery(api.cards.searchCards, {
    searchQuery: searchQuery || undefined,
    types: selectedType ? [selectedType as any] : undefined,
    limit: 100,
  });

  // Define dynamic styles
  const dynamicStyles = {
    loadingText: {
      color: colors.secondaryLabel,
    },
    errorTitle: {
      color: colors.label,
    },
    errorDescription: {
      color: colors.secondaryLabel,
    },
    emptyTitle: {
      color: colors.label,
    },
    emptyDescription: {
      color: colors.secondaryLabel,
    },
  };

  // Remove session loading check since we're using mock auth

  const renderMasonryLayout = () => {
    const cardsList = cards || [];
    if (cardsList.length === 0) {
      return null;
    }

    const leftColumn: Card[] = [];
    const rightColumn: Card[] = [];

    // Simple alternating distribution for masonry effect
    cardsList.forEach((card, index) => {
      if (index % 2 === 0) {
        leftColumn.push(card);
      } else {
        rightColumn.push(card);
      }
    });

    return (
      <View style={styles.masonryContainer}>
        <View style={styles.column}>
          {leftColumn.map((card) => (
            <View key={card._id} style={styles.cardContainer}>
              <CardItem card={card} />
            </View>
          ))}
        </View>
        <View style={styles.column}>
          {rightColumn.map((card) => (
            <View key={card._id} style={styles.cardContainer}>
              <CardItem card={card} />
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={[styles.emptyTitle, dynamicStyles.emptyTitle]}>
        {searchQuery ? "No cards found" : "No cards yet"}
      </Text>
      <Text style={[styles.emptyDescription, dynamicStyles.emptyDescription]}>
        {searchQuery
          ? `No cards match "${searchQuery}"${selectedType ? ` in ${selectedType} cards` : ""}`
          : "Start by adding your first card"}
      </Text>
    </View>
  );

  if (cards === undefined) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  if (cards.length === 0) {
    return renderEmpty();
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {renderMasonryLayout()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    flex: 1,
  },
  container: {
    padding: 16,
    paddingBottom: 100,
  },
  masonryContainer: {
    flexDirection: "row",
    gap: 8,
  },
  column: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorTitle: {
    fontWeight: "600",
    marginBottom: 8,
  },
  errorDescription: {
    textAlign: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyTitle: {
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyDescription: {
    textAlign: "center",
    lineHeight: 20,
  },
});
