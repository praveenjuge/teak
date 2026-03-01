import {
  Button,
  ContextMenu,
  HStack,
  Image,
  RNHostView,
  RoundedRectangle,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  cornerRadius,
  foregroundStyle,
  frame,
  lineLimit,
  onTapGesture,
} from "@expo/ui/swift-ui/modifiers";
import type { Doc } from "@teak/convex/_generated/dataModel";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { memo, type ReactNode, useEffect, useMemo, useState } from "react";
import { Alert, Platform, Image as RNImage } from "react-native";
import { colors } from "@/constants/colors";

const WWW_PREFIX_REGEX = /^www\./;
const FAVICON_RENDER_DELAY_MS = 250;
const failedFaviconHosts = new Set<string>();

type Card = Doc<"cards"> & {
  fileUrl?: string;
  screenshotUrl?: string;
  thumbnailUrl?: string;
};

interface CardItemProps {
  card: Card;
  onDeleteRequest?: () => void;
  onPress?: () => void;
}

interface RowProps {
  content: ReactNode;
  contextItems?: ReactNode[];
  leading?: ReactNode;
  onDelete?: () => void;
  onPress?: () => void;
  trailing?: ReactNode;
}

const iconModifiers = [frame({ height: 28, width: 28 })];

const leadingIcon = (systemName: string) => (
  <Image
    color="secondary"
    modifiers={iconModifiers}
    size={16}
    systemName={systemName as any}
  />
);

const Row = ({
  leading,
  content,
  trailing,
  onPress,
  onDelete,
  contextItems = [],
}: RowProps) => (
  <ContextMenu>
    <ContextMenu.Items>
      {contextItems}
      <Button label="Delete" onPress={onDelete} systemImage="trash" />
    </ContextMenu.Items>
    <ContextMenu.Trigger>
      <HStack modifiers={onPress ? [onTapGesture(onPress)] : []} spacing={12}>
        {leading}
        {content}
        <Spacer />
        {trailing}
      </HStack>
    </ContextMenu.Trigger>
  </ContextMenu>
);

const Favicon = ({ hostname, url }: { hostname?: string; url?: string }) => {
  const [hasError, setHasError] = useState(false);
  const [isReadyToRenderRemote, setIsReadyToRenderRemote] = useState(false);

  useEffect(() => {
    setHasError(false);
    setIsReadyToRenderRemote(false);

    if (!(url && hostname) || failedFaviconHosts.has(hostname)) {
      return;
    }

    const delay = setTimeout(() => {
      setIsReadyToRenderRemote(true);
    }, FAVICON_RENDER_DELAY_MS);

    return () => clearTimeout(delay);
  }, [hostname, url]);

  const shouldShowRemoteImage = Boolean(
    url &&
      hostname &&
      !hasError &&
      isReadyToRenderRemote &&
      !failedFaviconHosts.has(hostname)
  );
  const showFallback = !shouldShowRemoteImage;

  return (
    <VStack alignment="center" modifiers={[frame({ height: 28, width: 28 })]}>
      {showFallback ? (
        <Image
          color="secondary"
          modifiers={[frame({ height: 28, width: 28 })]}
          size={18}
          systemName="globe"
        />
      ) : (
        <RNHostView matchContents>
          <RNImage
            onError={() => {
              setHasError(true);
              if (hostname) {
                failedFaviconHosts.add(hostname);
              }
            }}
            resizeMode="cover"
            source={{ uri: url }}
            style={{
              height: 20,
              width: 20,
            }}
          />
        </RNHostView>
      )}
    </VStack>
  );
};

const PreviewBox = ({ children }: { children: React.ReactNode }) => (
  <VStack
    alignment="center"
    modifiers={[frame({ height: 28, width: 28 }), cornerRadius(2)]}
  >
    {children}
  </VStack>
);

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

const CardItem = memo(function CardItem({
  card,
  onPress,
  onDeleteRequest,
}: CardItemProps) {
  const mediaUrl = card.thumbnailUrl ?? card.fileUrl ?? null;

  const handleCopy = async (value?: string | null) => {
    if (!value) {
      return;
    }

    try {
      await Clipboard.setStringAsync(value);
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to copy content."
      );
    }
  };

  const handleDownload = async (url?: string | null, fileName?: string) => {
    if (!url) {
      return;
    }

    try {
      const name = buildFileName(url, fileName);

      if (Platform.OS === "ios") {
        const destination = `${FileSystem.cacheDirectory ?? ""}${name}`;
        const result = await FileSystem.downloadAsync(url, destination);

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(result.uri, {
            ...getShareOptions(name),
            dialogTitle: "Save to Files",
          });
        }

        return;
      }

      const destination = `${FileSystem.documentDirectory ?? ""}${name}`;
      const result = await FileSystem.downloadAsync(url, destination);
      Alert.alert("Downloaded", `Saved to ${result.uri}`);
    } catch (error) {
      if (
        !(
          error instanceof Error && error.message.includes("User did not share")
        )
      ) {
        Alert.alert("Download Failed", "Unable to download this file.");
      }
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
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to share content."
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
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to share file."
      );
    }
  };

  const handleDelete = () => {
    Alert.alert("Delete Card", "Are you sure you want to delete this card?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => onDeleteRequest?.(),
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
        favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
        hostname,
      };
    } catch {
      return {
        favicon: `https://www.google.com/s2/favicons?domain=${card.url}&sz=64`,
        hostname: card.url,
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
              label="Download"
              onPress={() => void handleDownload(url, name)}
              systemImage="arrow.down.circle"
            />,
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
          <Text modifiers={[lineLimit(1)]}>{linkTitle}</Text>,
          <Favicon hostname={linkMeta?.hostname} url={linkMeta?.favicon} />,
          undefined,
          [
            <Button
              key="copy-link"
              label="Copy Link"
              onPress={() => void handleCopy(card.url)}
              systemImage="doc.on.doc"
            />,
            <Button
              key="share-link"
              label="Share"
              onPress={() =>
                void handleShareText(card.url ?? "", linkMeta?.hostname)
              }
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "document": {
        const title =
          card.metadataTitle || card.fileMetadata?.fileName || "Attachment";
        const documentUrl = card.fileUrl ?? card.url ?? null;

        return renderRow(
          <Text modifiers={[lineLimit(1)]}>{title}</Text>,
          leadingIcon("paperclip"),
          undefined,
          [
            ...downloadItem(documentUrl, "download-document", title),
            <Button
              key="share-document"
              label="Share"
              onPress={() => void handleShareFromUrl(documentUrl, title)}
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "audio": {
        return renderRow(
          <Text modifiers={[lineLimit(1)]}>
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
              label="Share"
              onPress={() =>
                void handleShareFromUrl(
                  card.fileUrl,
                  card.fileMetadata?.fileName ?? "audio"
                )
              }
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "image": {
        const imageTitle =
          card.fileMetadata?.fileName || card.metadataTitle || "Image";
        const imageDownloadUrl =
          card.fileUrl ?? card.thumbnailUrl ?? card.screenshotUrl ?? null;

        return renderRow(
          <Text modifiers={[lineLimit(1)]}>{imageTitle}</Text>,
          <PreviewBox>
            {mediaUrl ? (
              <RNHostView matchContents>
                <RNImage
                  resizeMode="cover"
                  source={{ uri: mediaUrl }}
                  style={{ height: 28, width: 28 }}
                />
              </RNHostView>
            ) : (
              leadingIcon("photo")
            )}
          </PreviewBox>,
          undefined,
          [
            ...downloadItem(imageDownloadUrl, "download-image", imageTitle),
            <Button
              key="share-image"
              label="Share"
              onPress={() =>
                void handleShareFromUrl(imageDownloadUrl, imageTitle)
              }
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "video": {
        const videoTitle =
          card.fileMetadata?.fileName || card.metadataTitle || "Video";
        const videoDownloadUrl =
          card.fileUrl ?? card.thumbnailUrl ?? card.screenshotUrl ?? null;

        return renderRow(
          <Text modifiers={[lineLimit(1)]}>{videoTitle}</Text>,
          leadingIcon("play.circle"),
          undefined,
          [
            ...downloadItem(videoDownloadUrl, "download-video", videoTitle),
            <Button
              key="share-video"
              label="Share"
              onPress={() =>
                void handleShareFromUrl(videoDownloadUrl, videoTitle)
              }
              systemImage="square.and.arrow.up"
            />,
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
              label="Copy Palette"
              onPress={() =>
                void handleCopy(
                  card.colors?.map((color) => color.hex).join(", ") ?? ""
                )
              }
              systemImage="doc.on.doc"
            />,
            <Button
              key="share-palette"
              label="Share"
              onPress={() =>
                void handleShareText(
                  card.colors?.map((color) => color.hex).join(", ") ?? "",
                  "palette"
                )
              }
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "quote": {
        const textContent = card.content || "Quote";

        return renderRow(
          <Text modifiers={[lineLimit(1)]}>{`"${textContent}"`}</Text>,
          leadingIcon("text.quote"),
          undefined,
          [
            <Button
              key="copy-quote"
              label="Copy Quote"
              onPress={() => void handleCopy(textContent)}
              systemImage="doc.on.doc"
            />,
            <Button
              key="share-quote"
              label="Share"
              onPress={() => void handleShareText(textContent, "quote")}
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "text": {
        const textContent = card.content || "Note";

        return renderRow(
          <Text modifiers={[lineLimit(1)]}>{textContent}</Text>,
          leadingIcon("textformat"),
          undefined,
          [
            <Button
              key="copy-text"
              label="Copy Text"
              onPress={() => void handleCopy(textContent)}
              systemImage="doc.on.doc"
            />,
            <Button
              key="share-text"
              label="Share"
              onPress={() => void handleShareText(textContent, "note")}
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      default:
        return renderRow(
          <Text modifiers={[foregroundStyle(colors.secondaryLabel as any)]}>
            {card.content}
          </Text>,
          leadingIcon("questionmark"),
          undefined,
          []
        );
    }
  };

  return renderContent();
});

export { CardItem };
