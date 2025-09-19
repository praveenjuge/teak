import { useAudioPlayer } from "expo-audio";
import { memo } from "react";
import {
  Alert,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery } from "convex/react";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { borderWidths, colors } from "@/constants/colors";
import { useCardActions } from "@/lib/hooks/useCardActionsMobile";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";

type Card = Doc<"cards">;

// Define props interface locally
interface CardItemProps {
  card: Card;
  onDelete?: () => void;
}

// Helper function to format duration
const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

// Simple seeded random function for consistent wave patterns
function seededRandom(seed: string, index: number): number {
  const hash = seed.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, index);
  return Math.abs(Math.sin(hash)) * 0.6 + 0.2; // Returns value between 0.2 and 0.8
}

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const CardItem = memo(function CardItem({ card, onDelete }: CardItemProps) {
  // Get file URLs from Convex
  const mediaUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );

  // For audio files, use the media URL
  const audioUrl = card.type === "audio" ? mediaUrl : null;

  // Use the new expo-audio hook
  const player = useAudioPlayer(audioUrl ? { uri: audioUrl } : null);

  // Card actions
  const cardActions = useCardActions();

  const classificationStatus = card.processingStatus?.classify?.status;
  const isClassifying =
    classificationStatus === "pending" ||
    classificationStatus === "in_progress";

  const dynamicStyles = {
    card: {
      backgroundColor: colors.background,
      borderWidth: borderWidths.hairline,
      borderColor: colors.border,
    },
    text: {
      color: colors.label,
    },
    mutedText: {
      color: colors.secondaryLabel,
    },
    primaryText: {
      color: colors.primary,
    },
  };

  const handleAudioPress = () => {
    if (!player) {
      return;
    }

    if (player.playing) {
      player.pause();
    } else {
      player.play();
    }
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
            await cardActions.handleDeleteCard(card._id);
            onDelete?.();
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

  const handleUrlPress = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert("Error", "Unable to open this URL");
      }
    } catch (error) {
      console.error("Failed to open URL:", error);
      Alert.alert("Error", "Failed to open URL");
    }
  };

  // Render content based on card type
  const renderCardContent = () => {
    if (isClassifying) {
      return (
        <View style={[styles.card, dynamicStyles.card, styles.pendingCard]}>
          <Text style={[styles.pendingText, dynamicStyles.mutedText]}>
            Analyzing...
          </Text>
        </View>
      );
    }

    switch (card.type) {
      case "image": {
        if (!mediaUrl) {
          return null;
        }

        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={handleLongPress}
            style={[styles.card, dynamicStyles.card]}
          >
            <View>
              <Image
                resizeMode="cover"
                source={{ uri: mediaUrl }}
                style={styles.image}
              />
            </View>
          </TouchableOpacity>
        );
      }

      case "video":
        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={handleLongPress}
            style={[styles.card, dynamicStyles.card]}
          >
            <View style={styles.videoContainer}>
              <View style={styles.videoPlaceholder} />
              <View style={styles.playOverlay}>
                <View style={styles.playButton}>
                  <IconSymbol color="white" name="play.fill" size={14} />
                </View>
              </View>
              {card.fileMetadata?.duration && (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationText}>
                    {formatDuration(card.fileMetadata.duration)}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        );

      case "audio":
        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={handleLongPress}
            onPress={handleAudioPress}
            style={[styles.card, dynamicStyles.card]}
          >
            <View style={styles.audioWaveform}>
              {Array.from({ length: 40 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.waveformBar,
                    {
                      height: `${seededRandom(card._id, i) * 60 + 20}%`,
                      backgroundColor: colors.secondaryLabel,
                    },
                  ]}
                />
              ))}
            </View>
          </TouchableOpacity>
        );

      case "link":
        if (!card.url) {
          return null;
        }

        const linkPreview =
          card.metadata?.linkPreview?.status === "success"
            ? card.metadata.linkPreview
            : undefined;
        const linkTitle =
          linkPreview?.title ||
          card.metadataTitle ||
          card.metadata?.microlinkData?.data?.title ||
          card.url;
        const linkImage =
          linkPreview?.imageUrl ||
          card.metadata?.microlinkData?.data?.image?.url;

        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={handleLongPress}
            onPress={() => handleUrlPress(card.url!)}
            style={[styles.card, dynamicStyles.card]}
          >
            <View>
              {linkImage && (
                <Image
                  resizeMode="cover"
                  source={{ uri: linkImage }}
                  style={styles.urlImage}
                />
              )}
              <View style={styles.urlTextContainer}>
                <Text
                  numberOfLines={1}
                  style={[styles.urlTitle, dynamicStyles.text]}
                >
                  {linkTitle}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        );

      case "text":
        if (!card.content) {
          return null;
        }
        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={handleLongPress}
            style={[styles.card, dynamicStyles.card, styles.cardPadding]}
          >
            <Text
              style={[styles.textContent, dynamicStyles.mutedText]}
              numberOfLines={3}
            >
              {card.content}
            </Text>
          </TouchableOpacity>
        );

      case "quote":
        if (!card.content) {
          return null;
        }
        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={handleLongPress}
            style={[styles.card, dynamicStyles.card, styles.cardPadding]}
          >
            <View style={styles.quoteContent}>
              <Text style={[styles.quoteIcon, dynamicStyles.mutedText]}>
                &ldquo;
              </Text>
              <Text
                style={[styles.quoteText, dynamicStyles.text]}
                numberOfLines={3}
              >
                {card.content}
              </Text>
            </View>
          </TouchableOpacity>
        );

      case "document":
        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={handleLongPress}
            onPress={() => {
              if (mediaUrl) {
                handleUrlPress(mediaUrl);
              }
            }}
            style={[styles.card, dynamicStyles.card, styles.cardPadding]}
          >
            <View style={styles.pdfContent}>
              <View style={styles.pdfHeader}>
                <View style={styles.pdfIcon}>
                  <IconSymbol color="white" name="doc.fill" size={20} />
                </View>
                <View style={styles.pdfInfo}>
                  <Text
                    style={[styles.pdfTitle, dynamicStyles.text]}
                    numberOfLines={1}
                  >
                    {card.metadataTitle ||
                      card.fileMetadata?.fileName ||
                      "Document"}
                  </Text>
                  <View style={styles.pdfMeta}>
                    {card.fileMetadata?.fileSize && (
                      <Text
                        style={[styles.pdfMetaText, dynamicStyles.mutedText]}
                      >
                        {formatFileSize(card.fileMetadata.fileSize)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        );

      default:
        // Handle palette cards and other text-based cards
        if (card.type === "palette") {
          return (
            <TouchableOpacity
              activeOpacity={0.8}
              onLongPress={handleLongPress}
              style={[styles.card, dynamicStyles.card]}
            >
              <View style={styles.paletteStrip}>
                {card.colors?.slice(0, 12).map((color, index) => (
                  <View
                    key={`${color.hex}-${index}`}
                    style={[styles.colorStripe, { backgroundColor: color.hex }]}
                  />
                ))}
              </View>
            </TouchableOpacity>
          );
        }

        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={handleLongPress}
            style={[styles.card, dynamicStyles.card]}
          >
            <Text style={[dynamicStyles.mutedText]}>
              Unsupported card type: {card.type}
            </Text>
          </TouchableOpacity>
        );
    }
  };

  return <>{renderCardContent()}</>;
});

export { CardItem };

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  pendingCard: {
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  pendingText: {
    fontSize: 13,
    fontWeight: "500",
  },
  cardPadding: {
    padding: 16,
  },
  image: {
    width: "100%",
    aspectRatio: 1.5,
    minHeight: 100,
  },
  videoContainer: {
    overflow: "hidden",
    position: "relative",
  },
  video: {
    width: "100%",
    height: 120,
  },
  videoPlaceholder: {
    width: "100%",
    height: 120,
    backgroundColor: "#e5e5e5",
    justifyContent: "center",
    alignItems: "center",
  },
  playOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  playButton: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 24,
    padding: 12,
  },
  durationBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    color: "white",
  },
  audioWaveform: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 56,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  waveformBar: {
    width: 2,
    borderRadius: 1,
    minHeight: 4,
  },
  urlImage: {
    width: "100%",
    height: 120,
  },
  urlTextContainer: {
    padding: 16,
  },
  urlTitle: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  pdfContent: {
    flexDirection: "column",
  },
  pdfHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  pdfIcon: {
    backgroundColor: "#dc2626",
    borderRadius: 20,
    padding: 8,
    marginRight: 12,
  },
  pdfInfo: {
    flex: 1,
  },
  pdfTitle: {
    fontWeight: "600",
    fontSize: 14,
  },
  pdfMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  pdfMetaText: {},
  // Palette card styles
  paletteStrip: {
    flexDirection: "row",
    height: 56,
  },
  colorStripe: {
    flex: 1,
    minWidth: 0,
  },
  // Quote card styles
  quoteContent: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  quoteIcon: {
    fontSize: 24,
    fontWeight: "bold",
    opacity: 0.3,
    marginRight: 8,
    marginTop: -4,
  },
  quoteText: {
    flex: 1,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 18,
    opacity: 0.8,
  },
  // Text content styles
  textContent: {
    fontSize: 14,
    lineHeight: 18,
  },
});
