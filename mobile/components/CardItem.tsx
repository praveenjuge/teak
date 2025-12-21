import { memo, useMemo, useState, type ReactNode } from "react";
import { Alert, Image as RNImage } from "react-native";
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
  onPress?: () => void;
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
  <HStack spacing={12} onPress={onPress} modifiers={rowModifiers(onLongPress)}>
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

const CardItem = memo(function CardItem({ card, onPress }: CardItemProps) {
  const mediaUrl = card.fileUrl ?? null;
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
            onPress={onPress}
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
            onPress={onPress}
            onLongPress={handleDelete}
            content={<Text lineLimit={1}>{title}</Text>}
          />
        );
      }

      case "audio": {
        return (
          <Row
            leading={
              <Image
                systemName="music.note"
                size={16}
                modifiers={[frame({ width: 28, height: 28 })]}
                color="secondary"
              />
            }
            onPress={onPress}
            onLongPress={handleDelete}
            content={
              <Text lineLimit={1}>
                {card.aiTranscript && card.aiTranscript.length > 10
                  ? card.aiTranscript
                  : "Audio"}
              </Text>
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
            onPress={onPress}
            onLongPress={handleDelete}
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
            onPress={onPress}
            onLongPress={handleDelete}
            content={<Text lineLimit={1}>{videoTitle}</Text>}
          />
        );
      }

      case "palette": {
        return (
          <Row
            onPress={onPress}
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
            onPress={onPress}
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
            onPress={onPress}
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
            onPress={onPress}
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
