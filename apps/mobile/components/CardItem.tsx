import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  Linking,
  ActivityIndicator,
} from "react-native";
import type { Card } from "@/lib/api";
import { apiClient } from "@/lib/api";
import { borderWidths, colors } from "@/constants/colors";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { getFullMediaUrl } from "@/lib/utils";
import { Audio } from "expo-av";

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

export function CardItem({ card, onDelete }: CardItemProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const isSeeking = useRef(false);

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
    if (!isSeeking.current) {
      if (status.isLoaded) {
        setPlaybackPosition(status.positionMillis / 1000);
        setIsPlaying(status.isPlaying);
        if (status.didJustFinish) {
          setIsPlaying(false);
          setPlaybackPosition(0);
          sound?.setPositionAsync(0);
        }
      }
    }
  };

  const playSound = async () => {
    if (!card.data.media_url) return;

    const fullAudioUrl = getFullMediaUrl(card.data.media_url);
    if (!fullAudioUrl) return;

    setIsLoading(true);
    try {
      if (sound) {
        await sound.playAsync();
      } else {
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: fullAudioUrl },
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
      case "image":
        if (!card.data.media_url) return null;

        const fullImageUrl = getFullMediaUrl(card.data.media_url);
        if (!fullImageUrl) {
          console.warn(
            "[CardItem] Could not construct full image URL for:",
            card.data.media_url
          );
          return null;
        }

        return (
          <TouchableOpacity
            style={[styles.card, dynamicStyles.card]}
            onLongPress={handleLongPress}
            activeOpacity={0.8}
          >
            <View>
              <Image
                source={{ uri: fullImageUrl }}
                style={styles.image}
                resizeMode="cover"
                onError={(error) => {
                  console.error(
                    "[CardItem] Image load error:",
                    error.nativeEvent.error
                  );
                  console.error("[CardItem] Failed URL:", fullImageUrl);
                }}
                onLoadStart={() => {
                  console.log("[CardItem] Image load started:", fullImageUrl);
                }}
                onLoadEnd={() => {
                  console.log("[CardItem] Image load ended:", fullImageUrl);
                }}
              />
            </View>
          </TouchableOpacity>
        );

      case "video":
        return (
          <TouchableOpacity
            style={[styles.card, dynamicStyles.card]}
            onLongPress={handleLongPress}
            activeOpacity={0.8}
          >
            <View style={styles.videoContainer}>
              {card.data.thumbnail_url ? (
                <Image
                  source={{
                    uri:
                      getFullMediaUrl(card.data.thumbnail_url) ||
                      card.data.thumbnail_url,
                  }}
                  style={styles.videoPlaceholder}
                  resizeMode="cover"
                />
              ) : card.data.media_url ? (
                <Image
                  source={{
                    uri:
                      getFullMediaUrl(card.data.media_url) ||
                      card.data.media_url,
                  }}
                  style={styles.videoPlaceholder}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.videoPlaceholder}></View>
              )}
              <View style={styles.playOverlay}>
                <View style={styles.playButton}>
                  <IconSymbol name="play.fill" size={14} color="white" />
                </View>
              </View>
              {card.data.duration && (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationText}>
                    {formatDuration(card.data.duration)}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        );

      case "audio":
        return (
          <TouchableOpacity
            style={[styles.card, dynamicStyles.card, styles.cardPadding]}
            onPress={handleAudioPress}
            onLongPress={handleLongPress}
            activeOpacity={0.8}
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
                    name={isPlaying ? "pause.fill" : "play.fill"}
                    size={14}
                    color="white"
                  />
                )}
              </View>
              <View style={styles.audioInfo}>
                <Text style={[styles.audioTime, dynamicStyles.mutedText]}>
                  {formatDuration(playbackPosition)} /{" "}
                  {card.data.duration
                    ? formatDuration(card.data.duration)
                    : "--:--"}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        );

      case "url":
        if (!card.data.url) return null;
        return (
          <TouchableOpacity
            style={[styles.card, dynamicStyles.card, styles.cardPadding]}
            onPress={() => handleUrlPress(card.data.url)}
            onLongPress={handleLongPress}
            activeOpacity={0.8}
          >
            <View style={styles.urlContent}>
              <IconSymbol
                name="arrow.up.right.square"
                size={18}
                color={colors.primary}
              />
              <Text
                style={[styles.urlText, dynamicStyles.primaryText]}
                numberOfLines={1}
              >
                {card.data.title || card.data.url}
              </Text>
            </View>
          </TouchableOpacity>
        );

      case "text":
        if (!card.data.content) return null;
        return (
          <TouchableOpacity
            style={[styles.card, dynamicStyles.card, styles.cardPadding]}
            onLongPress={handleLongPress}
            activeOpacity={0.8}
          >
            <Text style={[dynamicStyles.mutedText]}>{card.data.content}</Text>
          </TouchableOpacity>
        );

      default:
        return (
          <TouchableOpacity
            style={[styles.card, dynamicStyles.card]}
            onLongPress={handleLongPress}
            activeOpacity={0.8}
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
  urlContent: {
    flexDirection: "row",
  },
  urlText: {
    marginLeft: 5,
  },
});
