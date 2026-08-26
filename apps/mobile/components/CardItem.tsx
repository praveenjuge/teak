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
  contentShape,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  onTapGesture,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { api } from "@teak/convex";
import { useConvex } from "convex/react";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import * as Sharing from "expo-sharing";
import { memo, type ReactNode, useMemo, useState } from "react";
import { Alert, Platform } from "react-native";
import { colors } from "@/constants/colors";
import { getNativeShareOptions } from "@/lib/files";
import type { MobileCardSummary } from "@/lib/mobile-card-summary-cache";

const WWW_PREFIX_REGEX = /^www\./;
const failedFaviconHosts = new Set<string>();

interface CardItemProps {
  card: MobileCardSummary;
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
      <HStack
        modifiers={
          onPress
            ? [contentShape(shapes.rectangle()), onTapGesture(onPress)]
            : []
        }
        spacing={12}
      >
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

  const shouldShowRemoteImage = Boolean(
    url && hostname && !hasError && !failedFaviconHosts.has(hostname)
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
          <ExpoImage
            cachePolicy="memory-disk"
            contentFit="cover"
            enforceEarlyResizing
            onError={() => {
              setHasError(true);
              if (hostname) {
                failedFaviconHosts.add(hostname);
              }
            }}
            priority="low"
            recyclingKey={hostname}
            source={url}
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
  // Compact (256px) keeps small mobile tiles light; grid remains fallback.
  const mediaUrl =
    card.compactUrl ?? card.thumbnailUrl ?? card.screenshotUrl ?? null;
  const convex = useConvex();

  const loadFullCard = () =>
    convex.query(api.cards.getCard, {
      id: card._id,
    });

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
            ...getNativeShareOptions(name),
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
        await Sharing.shareAsync(destination, getNativeShareOptions(fileName));
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
        await Sharing.shareAsync(result.uri, getNativeShareOptions(fileName));
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

  const handleDownloadCard = async (name?: string) => {
    const fullCard = await loadFullCard();
    await handleDownload(
      fullCard?.fileUrl ??
        fullCard?.thumbnailUrl ??
        fullCard?.screenshotUrl ??
        fullCard?.url,
      name ?? fullCard?.fileMetadata?.fileName
    );
  };

  const handleShareCardFile = async (name?: string) => {
    const fullCard = await loadFullCard();
    await handleShareFromUrl(
      fullCard?.fileUrl ??
        fullCard?.thumbnailUrl ??
        fullCard?.screenshotUrl ??
        fullCard?.url,
      name ?? fullCard?.fileMetadata?.fileName
    );
  };

  const handleCopyCardText = async (fallback: string) => {
    const fullCard = await loadFullCard();
    await handleCopy(fullCard?.content ?? fallback);
  };

  const handleShareCardText = async (fallback: string, name: string) => {
    const fullCard = await loadFullCard();
    await handleShareText(fullCard?.content ?? fallback, name);
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
        favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`,
        hostname,
      };
    } catch {
      // URL didn't parse: never send the raw value to the third-party favicon
      // service, since it can contain a full path/query with IDs or tokens.
      return {
        favicon: undefined,
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
    switch (card.type) {
      case "link": {
        if (!card.url) {
          return null;
        }

        const linkTitle = card.title || card.url;

        return renderRow(
          <Text modifiers={[font({ design: "rounded" }), lineLimit(1)]}>
            {linkTitle}
          </Text>,
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
        const title = card.title || card.fileName || "Attachment";

        return renderRow(
          <Text modifiers={[font({ design: "rounded" }), lineLimit(1)]}>
            {title}
          </Text>,
          leadingIcon("paperclip"),
          undefined,
          [
            <Button
              key="download-document"
              label="Download"
              onPress={() => void handleDownloadCard(title)}
              systemImage="arrow.down.circle"
            />,
            <Button
              key="share-document"
              label="Share"
              onPress={() => void handleShareCardFile(title)}
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "audio": {
        return renderRow(
          <Text modifiers={[font({ design: "rounded" }), lineLimit(1)]}>
            {card.previewText && card.previewText.length > 10
              ? card.previewText
              : "Audio"}
          </Text>,
          leadingIcon("music.note"),
          undefined,
          [
            <Button
              key="download-audio"
              label="Download"
              onPress={() => void handleDownloadCard(card.fileName ?? "audio")}
              systemImage="arrow.down.circle"
            />,
            <Button
              key="share-audio"
              label="Share"
              onPress={() => void handleShareCardFile(card.fileName ?? "audio")}
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "image": {
        const imageTitle = card.title || card.fileName || "Image";

        return renderRow(
          <Text modifiers={[font({ design: "rounded" }), lineLimit(1)]}>
            {imageTitle}
          </Text>,
          <PreviewBox>
            {mediaUrl ? (
              <RNHostView matchContents>
                <ExpoImage
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  enforceEarlyResizing
                  recyclingKey={card._id}
                  source={mediaUrl}
                  style={{ height: 28, width: 28 }}
                />
              </RNHostView>
            ) : (
              leadingIcon("photo")
            )}
          </PreviewBox>,
          undefined,
          [
            <Button
              key="download-image"
              label="Download"
              onPress={() => void handleDownloadCard(imageTitle)}
              systemImage="arrow.down.circle"
            />,
            <Button
              key="share-image"
              label="Share"
              onPress={() => void handleShareCardFile(imageTitle)}
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "video": {
        const videoTitle = card.title || card.fileName || "Video";

        return renderRow(
          <Text modifiers={[font({ design: "rounded" }), lineLimit(1)]}>
            {videoTitle}
          </Text>,
          leadingIcon("play.circle"),
          undefined,
          [
            <Button
              key="download-video"
              label="Download"
              onPress={() => void handleDownloadCard(videoTitle)}
              systemImage="arrow.down.circle"
            />,
            <Button
              key="share-video"
              label="Share"
              onPress={() => void handleShareCardFile(videoTitle)}
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "palette": {
        return renderRow(
          card.colors
            ?.slice(0, 10)
            .map((color) => (
              <RoundedRectangle
                key={color}
                modifiers={[foregroundStyle(color as any), cornerRadius(6)]}
              />
            )),
          leadingIcon("paintpalette"),
          undefined,
          [
            <Button
              key="copy-palette"
              label="Copy Palette"
              onPress={() => void handleCopy(card.colors?.join(", ") ?? "")}
              systemImage="doc.on.doc"
            />,
            <Button
              key="share-palette"
              label="Share"
              onPress={() =>
                void handleShareText(card.colors?.join(", ") ?? "", "palette")
              }
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "quote": {
        const textContent = card.previewText || "Quote";

        return renderRow(
          <Text
            modifiers={[font({ design: "rounded" }), lineLimit(1)]}
          >{`"${textContent}"`}</Text>,
          leadingIcon("text.quote"),
          undefined,
          [
            <Button
              key="copy-quote"
              label="Copy Quote"
              onPress={() => void handleCopyCardText(textContent)}
              systemImage="doc.on.doc"
            />,
            <Button
              key="share-quote"
              label="Share"
              onPress={() => void handleShareCardText(textContent, "quote")}
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      case "text": {
        const textContent = card.previewText || "Note";

        return renderRow(
          <Text modifiers={[font({ design: "rounded" }), lineLimit(1)]}>
            {textContent}
          </Text>,
          leadingIcon("textformat"),
          undefined,
          [
            <Button
              key="copy-text"
              label="Copy Text"
              onPress={() => void handleCopyCardText(textContent)}
              systemImage="doc.on.doc"
            />,
            <Button
              key="share-text"
              label="Share"
              onPress={() => void handleShareCardText(textContent, "note")}
              systemImage="square.and.arrow.up"
            />,
          ]
        );
      }

      default:
        return renderRow(
          <Text
            modifiers={[
              font({ design: "rounded" }),
              foregroundStyle(colors.secondaryLabel as any),
            ]}
          >
            {card.previewText}
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
