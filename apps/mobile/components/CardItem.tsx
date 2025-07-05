import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  useColorScheme,
} from "react-native";
import type { Card } from "@/lib/api";
import { apiClient } from "@/lib/api";

interface CardItemProps {
  card: Card;
  onDelete?: () => void;
}

const getCardTitle = (card: Card): string => {
  const { data } = card;
  return (
    data.title ||
    data.name ||
    data.url ||
    `${card.type.charAt(0).toUpperCase() + card.type.slice(1)} Card`
  );
};

const getCardContent = (card: Card): string => {
  const { data } = card;

  switch (card.type) {
    case "text":
      return data.content || "";
    case "audio":
    case "video":
      return data.transcription || data.description || "";
    case "url":
      return data.description || data.url || "";
    case "image":
      return data.description || data.alt_text || "";
    default:
      return JSON.stringify(data);
  }
};

const getCardEmoji = (type: Card["type"]): string => {
  switch (type) {
    case "text":
      return "📝";
    case "image":
      return "🖼️";
    case "video":
      return "🎥";
    case "audio":
      return "🎵";
    case "url":
      return "🔗";
    default:
      return "📄";
  }
};

export function CardItem({ card, onDelete }: CardItemProps) {
  const title = getCardTitle(card);
  const content = getCardContent(card);
  const emoji = getCardEmoji(card.type);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const dynamicStyles = {
    card: {
      backgroundColor: isDark ? "#1f1f1f" : "#fff",
    },
    title: {
      color: isDark ? "#fff" : "#333",
    },
    content: {
      color: isDark ? "#ccc" : "#666",
    },
    duration: {
      color: isDark ? "#ccc" : "#666",
    },
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Card",
      "Are you sure you want to delete this card? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await apiClient.deleteCard(card.id);
              onDelete?.();
            } catch (error) {
              console.error("Failed to delete card:", error);
              Alert.alert("Error", "Failed to delete card. Please try again.");
            }
          },
        },
      ]
    );
  };

  const handleLongPress = () => {
    Alert.alert("Card Options", "What would you like to do with this card?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: handleDelete },
    ]);
  };

  return (
    <TouchableOpacity
      style={[styles.card, dynamicStyles.card]}
      onLongPress={handleLongPress}
      activeOpacity={0.8}
    >
      <Text style={styles.emoji}>{emoji}</Text>

      <Text style={[styles.title, dynamicStyles.title]} numberOfLines={2}>
        {title}
      </Text>

      {content && (
        <Text style={[styles.content, dynamicStyles.content]} numberOfLines={3}>
          {content}
        </Text>
      )}

      {/* Render type-specific content */}
      {card.type === "image" && card.data.media_url && (
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: card.data.media_url }}
            style={styles.image}
            resizeMode="cover"
          />
        </View>
      )}

      {(card.type === "audio" || card.type === "video") &&
        card.data.duration && (
          <Text style={[dynamicStyles.duration]}>
            Duration: {Math.floor(card.data.duration / 60)}:
            {(card.data.duration % 60).toString().padStart(2, "0")}
          </Text>
        )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  emoji: {
    marginBottom: 6,
  },
  title: {
    fontWeight: "600",
    marginBottom: 6,
  },
  content: {
    lineHeight: 20,
    marginBottom: 6,
  },
  imageContainer: {
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 6,
  },
  image: {
    width: "100%",
    height: 100,
  },
});
