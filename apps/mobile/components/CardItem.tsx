import { Audio } from "expo-av";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery, useMutation } from "convex/react";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { borderWidths, colors } from "@/constants/colors";
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

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export function CardItem({ card, onDelete }: CardItemProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const isSeeking = useRef(false);

  // Get file URLs from Convex
  const mediaUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );
  const thumbnailUrl = useQuery(
    api.cards.getFileUrl,
    card.thumbnailId ? { fileId: card.thumbnailId } : "skip"
  );

  // For audio files, use the media URL
  const audioUrl = card.type === "audio" ? mediaUrl : null;

  // Convex mutations
  const deleteCardMutation = useMutation(api.cards.deleteCard);

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

  useEffect(() => {
    return sound
      ? () => {
          sound.unloadAsync();
        }
      : undefined;
  }, [sound]);

  const onPlaybackStatusUpdate = (status: any) => {
    if (!isSeeking.current && status.isLoaded) {
      setPlaybackPosition(status.positionMillis / 1000);
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish) {
        setIsPlaying(false);
        setPlaybackPosition(0);
        sound?.setPositionAsync(0);
      }
    }
  };

  const playSound = async () => {
    if (!audioUrl) {
      return;
    }

    setIsLoading(true);
    try {
      if (sound) {
        await sound.playAsync();
      } else {
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: true },
          onPlaybackStatusUpdate
        );
        setSound(newSound);
      }
    } catch (error) {
      console.error("Failed to play sound", error);
      Alert.alert("Error", "Could not play audio.");
    } finally {
      setIsLoading(false);
    }
  };

  const pauseSound = async () => {
    if (sound) {
      await sound.pauseAsync();
    }
  };

  const handleAudioPress = () => {
    if (isPlaying) {
      pauseSound();
    } else {
      playSound();
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
            try {
              await deleteCardMutation({ id: card._id });
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
                onError={(error) => {
                  console.error(
                    "[CardItem] Image load error:",
                    error.nativeEvent.error
                  );
                  console.error("[CardItem] Failed URL:", mediaUrl);
                }}
                onLoadEnd={() => {
                  console.log("[CardItem] Image load ended:", mediaUrl);
                }}
                onLoadStart={() => {
                  console.log("[CardItem] Image load started:", mediaUrl);
                }}
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
              {thumbnailUrl ? (
                <Image
                  resizeMode="cover"
                  source={{ uri: thumbnailUrl }}
                  style={styles.videoPlaceholder}
                />
              ) : mediaUrl ? (
                <Image
                  resizeMode="cover"
                  source={{ uri: mediaUrl }}
                  style={styles.videoPlaceholder}
                />
              ) : (
                <View style={styles.videoPlaceholder} />
              )}
              <View style={styles.playOverlay}>
                <View style={styles.playButton}>
                  <IconSymbol color="white" name="play.fill" size={14} />
                </View>
              </View>
              {card.metadata?.duration && (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationText}>
                    {formatDuration(card.metadata.duration)}
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
            style={[styles.card, dynamicStyles.card, styles.cardPadding]}
          >
            <View style={styles.audioContent}>
              <View
                style={[
                  styles.audioPlayButton,
                  { backgroundColor: colors.primary },
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <IconSymbol
                    color="white"
                    name={isPlaying ? "pause.fill" : "play.fill"}
                    size={14}
                  />
                )}
              </View>
              <View style={styles.audioInfo}>
                <Text style={[styles.audioTime, dynamicStyles.mutedText]}>
                  {formatDuration(playbackPosition)} /{" "}
                  {card.metadata?.duration
                    ? formatDuration(card.metadata.duration)
                    : "--:--"}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        );

      case "link":
        if (!card.url) {
          return null;
        }
        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={handleLongPress}
            onPress={() => handleUrlPress(card.url!)}
            style={[styles.card, dynamicStyles.card]}
          >
            {thumbnailUrl ? (
              <View style={styles.urlWithScreenshot}>
                <Image
                  resizeMode="cover"
                  source={{ uri: thumbnailUrl }}
                  style={styles.urlScreenshot}
                />
                <View style={styles.urlScreenshotOverlay}>
                  <View style={styles.urlScreenshotBadge}>
                    <IconSymbol
                      color="white"
                      name="arrow.up.right.square"
                      size={14}
                    />
                  </View>
                </View>
              </View>
            ) : null}
            <View
              style={[
                styles.urlContent,
                thumbnailUrl && styles.urlContentWithScreenshot,
              ]}
            >
              {!thumbnailUrl && (
                <IconSymbol
                  color={colors.primary}
                  name="arrow.up.right.square"
                  size={18}
                />
              )}
              <View style={styles.urlTextContainer}>
                <Text
                  numberOfLines={1}
                  style={[styles.urlTitle, dynamicStyles.primaryText]}
                >
                  {card.metadataTitle || card.metadata?.linkTitle || card.url}
                </Text>
                {(card.metadataDescription ||
                  card.metadata?.linkDescription) && (
                  <Text
                    numberOfLines={2}
                    style={[styles.urlDescription, dynamicStyles.mutedText]}
                  >
                    {card.metadataDescription || card.metadata?.linkDescription}
                  </Text>
                )}
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
            <Text style={[dynamicStyles.mutedText]}>{card.content}</Text>
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
                  <Text style={[styles.pdfTitle, dynamicStyles.text]}>
                    {card.metadataTitle ||
                      card.metadata?.fileName ||
                      "Document"}
                  </Text>
                  <View style={styles.pdfMeta}>
                    {card.metadata?.fileSize && (
                      <Text
                        style={[styles.pdfMetaText, dynamicStyles.mutedText]}
                      >
                        {formatFileSize(card.metadata.fileSize)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        );

      default:
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
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    marginBottom: 8,
    overflow: "hidden",
  },
  cardPadding: {
    padding: 12,
  },
  image: {
    width: "100%",
    height: 120,
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
  audioContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  audioPlayButton: {
    borderRadius: 20,
    padding: 12,
  },
  audioInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  audioTime: {
    marginLeft: 4,
  },
  urlWithScreenshot: {
    position: "relative",
  },
  urlScreenshot: {
    width: "100%",
    height: 120,
  },
  urlScreenshotOverlay: {
    position: "absolute",
    top: 8,
    right: 8,
  },
  urlScreenshotBadge: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 12,
    padding: 6,
  },
  urlContent: {
    flexDirection: "row",
    padding: 12,
  },
  urlContentWithScreenshot: {
    paddingTop: 12,
  },
  urlTextContainer: {
    flex: 1,
    marginLeft: 8,
  },
  urlTitle: {
    fontWeight: "600",
  },
  urlDescription: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
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
    fontSize: 16,
  },
  pdfMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  pdfMetaText: {
    fontSize: 12,
  },
});
