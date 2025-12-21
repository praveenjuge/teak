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

const iconModifiers = [frame({ width: 28, height: 28 })];

const leadingIcon = (systemName: string) => (
  <Image
    systemName={systemName as any}
    size={16}
    modifiers={iconModifiers}
    color="secondary"
  />
);

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
    <Spacer />
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

  const renderRow = (
    content: ReactNode,
    leading?: ReactNode,
    trailing?: ReactNode
  ) => (
    <Row
      leading={leading}
      content={content}
      trailing={trailing}
      onPress={onPress}
      onLongPress={handleDelete}
    />
  );

  const renderContent = () => {
    switch (card.type) {
      case "link": {
        if (!card.url) return null;
        const linkTitle =
          card.metadata?.linkPreview?.status === "success"
            ? card.metadata.linkPreview.title || card.url
            : card.metadataTitle || card.url;

        return renderRow(
          <Text lineLimit={1}>{linkTitle}</Text>,
          <Favicon url={linkMeta?.favicon} />
        );
      }

      case "document": {
        const title =
          card.metadataTitle || card.fileMetadata?.fileName || "Attachment";
        return renderRow(
          <Text lineLimit={1}>{title}</Text>,
          leadingIcon("paperclip")
        );
      }

      case "audio": {
        return renderRow(
          <Text lineLimit={1}>
            {card.aiTranscript && card.aiTranscript.length > 10
              ? card.aiTranscript
              : "Audio"}
          </Text>,
          leadingIcon("music.note")
        );
      }

      case "image": {
        const imageTitle =
          card.fileMetadata?.fileName || card.metadataTitle || "Image";
        return renderRow(
          <Text lineLimit={1}>{imageTitle}</Text>,
          <PreviewBox>
            {mediaUrl ? (
              <RNImage
                source={{ uri: mediaUrl }}
                style={{ width: 28, height: 28 }}
                resizeMode="cover"
              />
            ) : (
              leadingIcon("photo")
            )}
          </PreviewBox>
        );
      }

      case "video": {
        const videoTitle =
          card.fileMetadata?.fileName || card.metadataTitle || "Video";
        return renderRow(
          <Text lineLimit={1}>{videoTitle}</Text>,
          leadingIcon("play.circle")
        );
      }

      case "palette": {
        return renderRow(
          card.colors
            ?.slice(0, 10)
            .map((color, index) => (
              <RoundedRectangle
                key={`${color.hex}-${index}`}
                modifiers={[foregroundStyle(color.hex as any), cornerRadius(6)]}
              />
            )),
          leadingIcon("paintpalette")
        );
      }

      case "quote": {
        const textContent = card.content || "Quote";
        return renderRow(
          <Text lineLimit={1}>{`"${textContent}"`}</Text>,
          leadingIcon("text.quote")
        );
      }

      case "text": {
        const textContent = card.content || "Note";
        return renderRow(
          <Text lineLimit={1}>{textContent}</Text>,
          leadingIcon("textformat")
        );
      }

      default:
        return renderRow(
          <Text color={colors.secondaryLabel as any}>{card.content}</Text>,
          leadingIcon("questionmark")
        );
    }
  };

  return renderContent();
});

export { CardItem };
