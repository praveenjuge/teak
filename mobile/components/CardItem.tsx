import { useAudioPlayer } from "expo-audio";
import { memo, useMemo, useState, type ReactNode } from "react";
import { Alert, Image as RNImage, Linking } from "react-native";
import {
  HStack,
  VStack,
  Text,
  Image,
  Spacer,
  RoundedRectangle,
} from "@expo/ui/swift-ui";
import {
  onLongPressGesture,
  frame,
  cornerRadius,
  foregroundStyle,
} from "@expo/ui/swift-ui/modifiers";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { colors } from "@/constants/colors";
import { useCardActions } from "@/lib/hooks/useCardActionsMobile";

type Card = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
};

interface CardItemProps {
  card: Card;
}

const rowModifiers = (onLongPress?: () => void) => [
  ...(onLongPress ? [onLongPressGesture(onLongPress)] : []),
];

type RowProps = {
  leading?: ReactNode;
  content: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
};

const Row = ({
  leading,
  content,
  trailing,
  onPress,
  onLongPress,
}: RowProps) => (
  <HStack spacing={14} onPress={onPress} modifiers={rowModifiers(onLongPress)}>
    {leading}
    {content}
    {trailing ? <Spacer /> : null}
    {trailing}
  </HStack>
);

const Favicon = ({ url }: { url?: string }) => {
  const [hasError, setHasError] = useState(false);
  const showFallback = !url || hasError;

  return (
    <VStack alignment="center" modifiers={[frame({ width: 28, height: 28 })]}>
      {showFallback ? (
        <Image
          systemName="globe"
          size={18}
          modifiers={[frame({ width: 28, height: 28 })]}
          color="secondary"
        />
      ) : (
        <HStack
          alignment="center"
          modifiers={[frame({ width: 20, height: 20 })]}
        >
          <RNImage
            source={{ uri: url }}
            style={{
              width: 20,
              height: 20,
            }}
            resizeMode="cover"
            onError={() => setHasError(true)}
          />
        </HStack>
      )}
    </VStack>
  );
};

const PreviewBox = ({ children }: { children: React.ReactNode }) => (
  <VStack
    alignment="center"
    modifiers={[frame({ width: 28, height: 28 }), cornerRadius(2)]}
  >
    {children}
  </VStack>
);

const CardItem = memo(function CardItem({ card }: CardItemProps) {
  const mediaUrl = card.fileUrl ?? null;
  const audioUrl = card.type === "audio" ? mediaUrl : null;
  const player = useAudioPlayer(audioUrl ? { uri: audioUrl } : null);
  const cardActions = useCardActions();

  const handleDelete = () => {
    Alert.alert("Delete Card", "Are you sure you want to delete this card?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void cardActions.handleDeleteCard(card._id),
      },
    ]);
  };

  const handleUrlPress = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch (error) {
      console.error("Failed to open URL:", error);
    }
  };

  const linkMeta = useMemo(() => {
    if (!card.url) return null;
    try {
      const parsed = new URL(card.url);
      const hostname = parsed.hostname.replace(/^www\./, "");
      return {
        hostname,
        favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
      };
    } catch {
      return {
        hostname: card.url,
        favicon: `https://www.google.com/s2/favicons?domain=${card.url}&sz=64`,
      };
    }
  }, [card.url]);

  const renderContent = () => {
    switch (card.type) {
      case "link": {
        if (!card.url) return null;
        const linkTitle =
          card.metadata?.linkPreview?.status === "success"
            ? card.metadata.linkPreview.title || card.url
            : card.metadataTitle || card.url;

        return (
          <Row
            leading={<Favicon url={linkMeta?.favicon} />}
            trailing={
              <Image systemName="arrow.up.right" size={14} color="secondary" />
            }
            onPress={() => handleUrlPress(card.url!)}
            onLongPress={handleDelete}
            content={<Text lineLimit={1}>{linkTitle}</Text>}
          />
        );
      }

      case "document": {
        const title =
          card.metadataTitle || card.fileMetadata?.fileName || "Attachment";
        return (
          <Row
            leading={
              <Image
                systemName="paperclip"
                size={16}
                modifiers={[frame({ width: 28, height: 28 })]}
                color="secondary"
              />
            }
            onPress={() => {
              if (mediaUrl) void handleUrlPress(mediaUrl);
            }}
            onLongPress={handleDelete}
            trailing={
              mediaUrl ? (
                <VStack
                  alignment="center"
                  onPress={() => void handleUrlPress(mediaUrl)}
                >
                  <Image
                    systemName="arrow.up.right"
                    size={14}
                    color={colors.secondaryLabel as any}
                  />
                </VStack>
              ) : null
            }
            content={<Text lineLimit={1}>{title}</Text>}
          />
        );
      }

      case "audio": {
        const isPlaying = !!player?.playing;
        return (
          <Row
            leading={
              <Image
                systemName={isPlaying ? "pause" : "music.note"}
                size={16}
                modifiers={[frame({ width: 28, height: 28 })]}
                color="secondary"
              />
            }
            onPress={() => {
              if (!player) return;
              if (player.playing) {
                player.pause();
              } else {
                player.play();
              }
            }}
            onLongPress={handleDelete}
            content={
              <Text lineLimit={1}>
                {card.aiTranscript && card.aiTranscript.length > 10
                  ? card.aiTranscript
                  : "Audio"}
              </Text>
            }
            trailing={
              <VStack alignment="center">
                <Image
                  systemName="arrow.up.right"
                  size={14}
                  color={colors.secondaryLabel as any}
                />
              </VStack>
            }
          />
        );
      }

      case "image": {
        const imageTitle =
          card.fileMetadata?.fileName || card.metadataTitle || "Image";
        return (
          <Row
            leading={
              <PreviewBox>
                {mediaUrl ? (
                  <RNImage
                    source={{ uri: mediaUrl }}
                    style={{ width: 28, height: 28 }}
                    resizeMode="cover"
                  />
                ) : (
                  <Image
                    systemName="photo"
                    size={16}
                    modifiers={[frame({ width: 28, height: 28 })]}
                    color="secondary"
                  />
                )}
              </PreviewBox>
            }
            onPress={() => {
              if (mediaUrl) void handleUrlPress(mediaUrl);
            }}
            onLongPress={handleDelete}
            trailing={
              mediaUrl ? (
                <VStack
                  alignment="center"
                  onPress={() => void handleUrlPress(mediaUrl)}
                >
                  <Image
                    systemName="arrow.up.right"
                    size={14}
                    color={colors.secondaryLabel as any}
                  />
                </VStack>
              ) : null
            }
            content={<Text lineLimit={1}>{imageTitle}</Text>}
          />
        );
      }

      case "video": {
        const videoTitle =
          card.fileMetadata?.fileName || card.metadataTitle || "Video";
        return (
          <Row
            leading={
              <Image
                systemName="play.circle"
                size={16}
                modifiers={[frame({ width: 28, height: 28 })]}
                color="secondary"
              />
            }
            onPress={() => {
              if (mediaUrl) void handleUrlPress(mediaUrl);
            }}
            onLongPress={handleDelete}
            trailing={
              mediaUrl ? (
                <VStack
                  alignment="center"
                  onPress={() => void handleUrlPress(mediaUrl)}
                >
                  <Image
                    systemName="arrow.up.right"
                    size={14}
                    color={colors.secondaryLabel as any}
                  />
                </VStack>
              ) : null
            }
            content={<Text lineLimit={1}>{videoTitle}</Text>}
          />
        );
      }

      case "palette": {
        return (
          <Row
            onLongPress={handleDelete}
            leading={
              <Image
                systemName="paintpalette"
                size={16}
                modifiers={[frame({ width: 28, height: 28 })]}
                color="secondary"
              />
            }
            content={card.colors?.slice(0, 10).map((color, index) => (
              <RoundedRectangle
                key={`${color.hex}-${index}`}
                modifiers={[foregroundStyle(color.hex as any), cornerRadius(6)]}
              />
            ))}
          />
        );
      }

      case "quote": {
        const textContent = card.content || "Quote";
        return (
          <Row
            leading={
              <Image
                systemName="text.quote"
                size={16}
                modifiers={[frame({ width: 28, height: 28 })]}
                color="secondary"
              />
            }
            onLongPress={handleDelete}
            content={<Text lineLimit={1}>{`"${textContent}"`}</Text>}
          />
        );
      }

      case "text": {
        const textContent = card.content || "Note";
        return (
          <Row
            leading={
              <Image
                systemName="textformat"
                size={16}
                modifiers={[frame({ width: 28, height: 28 })]}
                color="secondary"
              />
            }
            onLongPress={handleDelete}
            content={<Text lineLimit={1}>{textContent}</Text>}
          />
        );
      }

      default:
        return (
          <Row
            leading={
              <Image
                systemName="questionmark"
                size={16}
                modifiers={[frame({ width: 28, height: 28 })]}
                color="secondary"
              />
            }
            onLongPress={handleDelete}
            content={
              <Text color={colors.secondaryLabel as any}>{card.content}</Text>
            }
          />
        );
    }
  };

  return renderContent();
});

export { CardItem };
