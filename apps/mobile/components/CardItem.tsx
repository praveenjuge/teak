import {
  Button,
  ContextMenu,
  HStack,
  Image,
  RoundedRectangle,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  cornerRadius,
  foregroundStyle,
  frame,
} from "@expo/ui/swift-ui/modifiers";
import type { Doc } from "@teak/convex/_generated/dataModel";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { memo, type ReactNode, useMemo, useState } from "react";
import { Alert, Platform, Image as RNImage } from "react-native";
import { colors } from "@/constants/colors";
import { useCardActions } from "@/lib/hooks/useCardActionsMobile";

const WWW_PREFIX_REGEX = /^www\./;

type Card = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
};

interface CardItemProps {
  card: Card;
  onPress?: () => void;
}

const iconModifiers = [frame({ width: 28, height: 28 })];

const leadingIcon = (systemName: string) => (
  <Image
    color="secondary"
    modifiers={iconModifiers}
    size={16}
    systemName={systemName as any}
  />
);

interface RowProps {
  leading?: ReactNode;
  content: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onDelete?: () => void;
  contextItems?: ReactNode[];
}

const Row = ({
  leading,
  content,
  trailing,
  onPress,
  onDelete,
  contextItems = [],
}: RowProps) => (
  <ContextMenu activationMethod="longPress">
    <ContextMenu.Items>
      {contextItems}
      <Button onPress={onDelete} systemImage="trash">
        Delete
      </Button>
    </ContextMenu.Items>
    <ContextMenu.Trigger>
      <HStack onPress={onPress} spacing={12}>
        {leading}
        {content}
        <Spacer />
        {trailing}
      </HStack>
    </ContextMenu.Trigger>
  </ContextMenu>
);

const Favicon = ({ url }: { url?: string }) => {
  const [hasError, setHasError] = useState(false);
  const showFallback = !url || hasError;

  return (
    <VStack alignment="center" modifiers={[frame({ width: 28, height: 28 })]}>
      {showFallback ? (
        <Image
          color="secondary"
          modifiers={[frame({ width: 28, height: 28 })]}
          size={18}
          systemName="globe"
        />
      ) : (
        <HStack
          alignment="center"
          modifiers={[frame({ width: 20, height: 20 })]}
        >
          <RNImage
            onError={() => setHasError(true)}
            resizeMode="cover"
            source={{ uri: url }}
            style={{
              width: 20,
              height: 20,
            }}
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
  const mediaUrl = card.thumbnailUrl ?? card.fileUrl ?? null;
  const cardActions = useCardActions();

  const handleCopy = async (value?: string | null) => {
    if (!value) {
      return;
    }
    try {
      await Clipboard.setStringAsync(value);
    } catch (error) {
      console.warn(
        "Failed to copy content:",
        error instanceof Error ? error.message : error
      );
    }
  };

  const buildFileName = (url?: string | null, fallback?: string) => {
    if (fallback) {
      return fallback;
    }
    if (!url) {
      return `download-${Date.now()}`;
    }
    try {
      const parsed = new URL(url);
      const lastSegment = parsed.pathname.split("/").filter(Boolean).pop();
      if (lastSegment) {
        return lastSegment;
      }
    } catch {
      // Ignore parse errors.
    }
    return `download-${Date.now()}`;
  };

  const handleDownload = async (url?: string | null, fileName?: string) => {
    if (!url) {
      return;
    }
    try {
      const name = buildFileName(url, fileName);

      // On iOS, use Sharing to allow saving to Downloads folder via "Save to Files"
      if (Platform.OS === "ios") {
        const destination = `${FileSystem.cacheDirectory ?? ""}${name}`;
        const result = await FileSystem.downloadAsync(url, destination);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(result.uri, {
            ...getShareOptions(name),
            dialogTitle: "Save to Downloads",
          });
        }
      } else {
        // On Android, save to Downloads directory directly
        const destination = `${FileSystem.documentDirectory ?? ""}${name}`;
        const result = await FileSystem.downloadAsync(url, destination);
        Alert.alert("Downloaded", `Saved to ${result.uri}`);
      }
    } catch (error) {
      // User cancelled sharing or actual error
      if (
        !(
          error instanceof Error && error.message.includes("User did not share")
        )
      ) {
        console.warn(
          "Failed to download file:",
          error instanceof Error ? error.message : error
        );
        Alert.alert("Download Failed", "Unable to download this file.");
      }
    }
  };

  const getShareOptions = (name?: string) => {
    const extension = name?.split(".").pop()?.toLowerCase();
    switch (extension) {
      case "m4a":
        return { UTI: "public.mpeg-4-audio", mimeType: "audio/mp4" };
      case "mp3":
        return { UTI: "public.mp3", mimeType: "audio/mpeg" };
      case "wav":
        return { UTI: "com.microsoft.waveform-audio", mimeType: "audio/wav" };
      case "mp4":
        return { UTI: "public.mpeg-4", mimeType: "video/mp4" };
      case "mov":
        return {
          UTI: "com.apple.quicktime-movie",
          mimeType: "video/quicktime",
        };
      case "png":
        return { UTI: "public.png", mimeType: "image/png" };
      case "jpg":
      case "jpeg":
        return { UTI: "public.jpeg", mimeType: "image/jpeg" };
      case "gif":
        return { UTI: "com.compuserve.gif", mimeType: "image/gif" };
      case "pdf":
        return { UTI: "com.adobe.pdf", mimeType: "application/pdf" };
      case "txt":
        return { UTI: "public.plain-text", mimeType: "text/plain" };
      default:
        return {};
    }
  };

  const handleShareText = async (value?: string | null, name?: string) => {
    if (!value) {
      return;
    }
    try {
      const fileName = name ? `${name}.txt` : `teak-share-${Date.now()}.txt`;
      const destination = `${FileSystem.cacheDirectory ?? ""}${fileName}`;
      await FileSystem.writeAsStringAsync(destination, value);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(destination, getShareOptions(fileName));
      } else {
        Alert.alert("Sharing Unavailable", "Sharing is not available here.");
      }
    } catch (error) {
      console.warn(
        "Failed to share text:",
        error instanceof Error ? error.message : error
      );
    }
  };

  const handleShareFromUrl = async (url?: string | null, name?: string) => {
    if (!url) {
      return;
    }
    try {
      const fileName = buildFileName(url, name);
      const destination = `${FileSystem.cacheDirectory ?? ""}${fileName}`;
      const result = await FileSystem.downloadAsync(url, destination);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, getShareOptions(fileName));
      } else {
        Alert.alert("Sharing Unavailable", "Sharing is not available here.");
      }
    } catch (error) {
      console.warn(
        "Failed to share file:",
        error instanceof Error ? error.message : error
      );
    }
  };

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
    if (!card.url) {
      return null;
    }
    try {
      const parsed = new URL(card.url);
      const hostname = parsed.hostname.replace(WWW_PREFIX_REGEX, "");
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
    trailing?: ReactNode,
    contextItems?: ReactNode[]
  ) => (
    <Row
      content={content}
      contextItems={contextItems}
      leading={leading}
      onDelete={handleDelete}
      onPress={onPress}
      trailing={trailing}
    />
  );

  const renderContent = () => {
    const downloadItem = (
      url?: string | null,
      key = "download",
      name?: string
    ) =>
      url
        ? [
            <Button
              key={key}
              onPress={() => void handleDownload(url, name)}
              systemImage="arrow.down.circle"
            >
              Download
            </Button>,
          ]
        : [];

    switch (card.type) {
      case "link": {
        if (!card.url) {
          return null;
        }
        const linkTitle =
          card.metadata?.linkPreview?.status === "success"
            ? card.metadata.linkPreview.title || card.url
            : card.metadataTitle || card.url;

        return renderRow(
          <Text lineLimit={1}>{linkTitle}</Text>,
          <Favicon url={linkMeta?.favicon} />,
          undefined,
          [
            <Button
              key="copy-link"
              onPress={() => void handleCopy(card.url)}
              systemImage="doc.on.doc"
            >
              Copy Link
            </Button>,
            <Button
              key="share-link"
              onPress={() =>
                void handleShareText(card.url ?? "", linkMeta?.hostname)
              }
              systemImage="square.and.arrow.up"
            >
              Share
            </Button>,
          ]
        );
      }

      case "document": {
        const title =
          card.metadataTitle || card.fileMetadata?.fileName || "Attachment";
        const documentUrl = card.fileUrl ?? card.url ?? null;
        return renderRow(
          <Text lineLimit={1}>{title}</Text>,
          leadingIcon("paperclip"),
          undefined,
          [
            ...downloadItem(documentUrl, "download-document", title),
            <Button
              key="share-document"
              onPress={() => void handleShareFromUrl(documentUrl, title)}
              systemImage="square.and.arrow.up"
            >
              Share
            </Button>,
          ]
        );
      }

      case "audio": {
        return renderRow(
          <Text lineLimit={1}>
            {card.aiTranscript && card.aiTranscript.length > 10
              ? card.aiTranscript
              : "Audio"}
          </Text>,
          leadingIcon("music.note"),
          undefined,
          [
            ...downloadItem(
              card.fileUrl,
              "download-audio",
              card.fileMetadata?.fileName ?? "audio"
            ),
            <Button
              key="share-audio"
              onPress={() =>
                void handleShareFromUrl(
                  card.fileUrl,
                  card.fileMetadata?.fileName ?? "audio"
                )
              }
              systemImage="square.and.arrow.up"
            >
              Share
            </Button>,
          ]
        );
      }

      case "image": {
        const imageTitle =
          card.fileMetadata?.fileName || card.metadataTitle || "Image";
        const imageDownloadUrl =
          card.fileUrl ?? card.thumbnailUrl ?? card.screenshotUrl ?? null;
        return renderRow(
          <Text lineLimit={1}>{imageTitle}</Text>,
          <PreviewBox>
            {mediaUrl ? (
              <RNImage
                resizeMode="cover"
                source={{ uri: mediaUrl }}
                style={{ width: 28, height: 28 }}
              />
            ) : (
              leadingIcon("photo")
            )}
          </PreviewBox>,
          undefined,
          [
            ...downloadItem(imageDownloadUrl, "download-image", imageTitle),
            <Button
              key="share-image"
              onPress={() =>
                void handleShareFromUrl(imageDownloadUrl, imageTitle)
              }
              systemImage="square.and.arrow.up"
            >
              Share
            </Button>,
          ]
        );
      }

      case "video": {
        const videoTitle =
          card.fileMetadata?.fileName || card.metadataTitle || "Video";
        const videoDownloadUrl =
          card.fileUrl ?? card.thumbnailUrl ?? card.screenshotUrl ?? null;
        return renderRow(
          <Text lineLimit={1}>{videoTitle}</Text>,
          leadingIcon("play.circle"),
          undefined,
          [
            ...downloadItem(videoDownloadUrl, "download-video", videoTitle),
            <Button
              key="share-video"
              onPress={() =>
                void handleShareFromUrl(videoDownloadUrl, videoTitle)
              }
              systemImage="square.and.arrow.up"
            >
              Share
            </Button>,
          ]
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
          leadingIcon("paintpalette"),
          undefined,
          [
            <Button
              key="copy-palette"
              onPress={() =>
                void handleCopy(
                  card.colors?.map((color) => color.hex).join(", ") ?? ""
                )
              }
              systemImage="doc.on.doc"
            >
              Copy Palette
            </Button>,
            <Button
              key="share-palette"
              onPress={() =>
                void handleShareText(
                  card.colors?.map((color) => color.hex).join(", ") ?? "",
                  "palette"
                )
              }
              systemImage="square.and.arrow.up"
            >
              Share
            </Button>,
          ]
        );
      }

      case "quote": {
        const textContent = card.content || "Quote";
        return renderRow(
          <Text lineLimit={1}>{`"${textContent}"`}</Text>,
          leadingIcon("text.quote"),
          undefined,
          [
            <Button
              key="copy-quote"
              onPress={() => void handleCopy(textContent)}
              systemImage="doc.on.doc"
            >
              Copy Quote
            </Button>,
            <Button
              key="share-quote"
              onPress={() => void handleShareText(textContent, "quote")}
              systemImage="square.and.arrow.up"
            >
              Share
            </Button>,
          ]
        );
      }

      case "text": {
        const textContent = card.content || "Note";
        return renderRow(
          <Text lineLimit={1}>{textContent}</Text>,
          leadingIcon("textformat"),
          undefined,
          [
            <Button
              key="copy-text"
              onPress={() => void handleCopy(textContent)}
              systemImage="doc.on.doc"
            >
              Copy Text
            </Button>,
            <Button
              key="share-text"
              onPress={() => void handleShareText(textContent, "note")}
              systemImage="square.and.arrow.up"
            >
              Share
            </Button>,
          ]
        );
      }

      default:
        return renderRow(
          <Text color={colors.secondaryLabel as any}>{card.content}</Text>,
          leadingIcon("questionmark"),
          undefined,
          []
        );
    }
  };

  return renderContent();
});

export { CardItem };
