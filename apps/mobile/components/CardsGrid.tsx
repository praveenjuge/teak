import { memo } from "react";
import {
  ActivityIndicator,
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

const CardsGrid = memo(function CardsGrid({ searchQuery, selectedType }: CardsGridProps) {
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
    let leftHeight = 0;
    let rightHeight = 0;

    // Estimate card heights for better distribution
    const estimateCardHeight = (card: Card): number => {
      switch (card.type) {
        case "image":
          // Use aspect ratio if available, otherwise default
          const aspectRatio = 
            card.fileMetadata?.width && card.fileMetadata?.height
              ? card.fileMetadata.width / card.fileMetadata.height
              : 1.5;
          return 180 / aspectRatio + 40; // Base width ~180, plus padding
        case "video":
          return 160;
        case "audio":
          return 88;
        case "palette":
          return 88;
        case "link":
          return card.metadata?.microlinkData?.data?.image?.url ? 180 : 120;
        case "text":
        case "quote":
          const contentLength = card.content?.length || 0;
          return Math.min(contentLength / 3 + 80, 200); // Estimate based on content length
        case "document":
          return 120;
        default:
          return 100;
      }
    };

    // Better distribution algorithm
    cardsList.forEach((card) => {
      const cardHeight = estimateCardHeight(card);
      
      if (leftHeight <= rightHeight) {
        leftColumn.push(card);
        leftHeight += cardHeight;
      } else {
        rightColumn.push(card);
        rightHeight += cardHeight;
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
});

export { CardsGrid };

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
    gap: 12,
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
