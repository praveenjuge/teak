import { useAudioPlayer } from "expo-audio";
import { memo, useMemo, type ReactNode } from "react";
import { Alert, Image as RNImage, Linking, View } from "react-native";
import { HStack, VStack, Text, Image, Spacer } from "@expo/ui/swift-ui";
import {
  onLongPressGesture,
  frame,
  cornerRadius,
} from "@expo/ui/swift-ui/modifiers";
import { useQuery } from "convex/react";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { colors } from "@/constants/colors";
import { useCardActions } from "@/lib/hooks/useCardActionsMobile";

type Card = Doc<"cards">;

interface CardItemProps {
  card: Card;
}

const seededRandom = (seed: string, index: number): number => {
  const hash = seed.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, index);
  return Math.abs(Math.sin(hash)) * 0.6 + 0.2;
};

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
  <HStack spacing={10} onPress={onPress} modifiers={rowModifiers(onLongPress)}>
    {leading}
    {content}
    {trailing ? <Spacer /> : null}
    {trailing}
  </HStack>
);

const Favicon = ({ url }: { url?: string }) => (
  <VStack
    alignment="center"
    modifiers={[frame({ width: 28, height: 28 }), cornerRadius(2)]}
  >
    {url ? (
      <View
        style={{
          justifyContent: "center",
          alignItems: "center",
          width: 28,
          height: 28,
        }}
      >
        <RNImage
          source={{ uri: url }}
          style={{
            width: 18,
            height: 18,
          }}
          resizeMode="cover"
        />
      </View>
    ) : (
      <Image
        systemName="globe"
        size={16}
        modifiers={[frame({ width: 28, height: 28 })]}
      />
    )}
  </VStack>
);

const PreviewBox = ({ children }: { children: React.ReactNode }) => (
  <VStack
    alignment="center"
    modifiers={[frame({ width: 28, height: 28 }), cornerRadius(2)]}
  >
    {children}
  </VStack>
);

const Waveform = ({ seed }: { seed: string }) => (
  <View
    style={{
      flexDirection: "row",
      alignItems: "center",
    }}
  >
    {Array.from({ length: 50 }).map((_, i) => {
      const height = Math.round(seededRandom(seed, i) * 26 + 8);
      return (
        <View
          key={i}
          style={{
            width: 2,
            height,
            marginHorizontal: 1,
            borderRadius: 1,
            backgroundColor: colors.secondaryLabel,
          }}
        />
      );
    })}
  </View>
);

const CardItem = memo(function CardItem({ card }: CardItemProps) {
  const mediaUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );

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
              <Image
                systemName="chevron.right"
                size={12}
                color={colors.secondaryLabel as any}
              />
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
              />
            }
            onPress={() => {
              if (mediaUrl) void handleUrlPress(mediaUrl);
            }}
            onLongPress={handleDelete}
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
            content={<Waveform seed={card._id} />}
          />
        );
      }

      case "image": {
        return (
          <Row
            leading={
              <PreviewBox>
                {mediaUrl ? (
                  <RNImage
                    source={{ uri: mediaUrl }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                ) : (
                  <Image
                    systemName="photo"
                    size={16}
                    modifiers={[frame({ width: 28, height: 28 })]}
                  />
                )}
              </PreviewBox>
            }
            onPress={() => {
              if (mediaUrl) void handleUrlPress(mediaUrl);
            }}
            onLongPress={handleDelete}
            content={<Text lineLimit={1}>{card.metadataTitle || "Image"}</Text>}
          />
        );
      }

      case "video": {
        const duration = card.fileMetadata?.duration;
        return (
          <Row
            leading={
              <PreviewBox>
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    right: 0,
                    backgroundColor: colors.border,
                  }}
                />
                <Image
                  systemName="play.circle.fill"
                  size={22}
                  color={colors.primary}
                />
              </PreviewBox>
            }
            onPress={() => {
              if (mediaUrl) void handleUrlPress(mediaUrl);
            }}
            onLongPress={handleDelete}
            content={<Text lineLimit={1}>{card.metadataTitle || "Video"}</Text>}
          />
        );
      }

      case "palette": {
        return (
          <Row
            onLongPress={handleDelete}
            content={
              <View
                style={{
                  flexDirection: "row",
                  height: 40,
                  borderRadius: 10,
                  overflow: "hidden",
                  borderColor: colors.border as any,
                }}
              >
                {card.colors?.slice(0, 10).map((color, index) => (
                  <View
                    key={`${color.hex}-${index}`}
                    style={{ flex: 1, backgroundColor: color.hex }}
                  />
                ))}
              </View>
            }
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
              />
            }
            onLongPress={handleDelete}
            content={<Text weight="semibold">{`"${textContent}"`}</Text>}
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
