import {
  Button,
  Capsule,
  ContextMenu,
  Divider,
  HStack,
  Image,
  Overlay,
  Rectangle,
  RNHostView,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  background,
  clipShape,
  contentShape,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  italic,
  lineLimit,
  multilineTextAlignment,
  onTapGesture,
  padding,
  shadow,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { api } from "@teak/convex";
import { useConvex } from "convex/react";
import * as Clipboard from "expo-clipboard";
import { Image as ExpoImage } from "expo-image";
import * as Sharing from "expo-sharing";
import { memo, type ReactNode, useMemo, useState } from "react";
import { Alert, Platform, PlatformColor } from "react-native";
import {
  getTileImageRatio,
  getTileImageUrl,
  getWaveformHeights,
  TILE_RADIUS,
  WAVEFORM_BAR_COUNT,
} from "@/lib/card-grid";
import { getNativeShareOptions } from "@/lib/files";
import type { MobileCardSummary } from "@/lib/mobile-card-summary-cache";
import {
  downloadNativeFile,
  writeNativeCacheText,
} from "@/lib/nativeFileSystem";

const WWW_PREFIX_REGEX = /^www\./;

interface CardItemProps {
  card: MobileCardSummary;
  /** The grid is showing Trash, so the menu offers Restore and Delete Forever. */
  inTrash?: boolean;
  /** Selection mode: null when not selecting. */
  isSelected?: boolean | null;
  onDeleteForeverRequest?: () => void;
  onDeleteRequest?: () => void;
  onPress?: () => void;
  onRestoreRequest?: () => void;
  onSelectRequest?: () => void;
  /** Width of the grid column; tiles size their media from it. */
  width: number;
}

const tileBackground = PlatformColor("secondarySystemGroupedBackground");
const roundedText = (size = 15, weight: "regular" | "medium" = "medium") =>
  font({ design: "rounded", size, weight });

/** The Photos-style selection check shown while selecting cards. */
const SelectionMark = ({ selected }: { selected: boolean }) => (
  <Image
    color={selected ? "white" : "secondary"}
    modifiers={[
      padding({ all: 4 }),
      background(
        selected
          ? PlatformColor("systemBlue")
          : PlatformColor("systemBackground"),
        shapes.circle()
      ),
      padding({ all: 8 }),
      shadow({ radius: 2, y: 1, color: "#00000033" }),
    ]}
    size={14}
    systemName={selected ? "checkmark" : "circle"}
  />
);

/**
 * The card surface shared by every tile: the grouped content background on
 * the grouped page background, rounded like the web cards.
 */
const TileSurface = ({
  children,
  favorite,
  onPress,
  selected = null,
  width,
}: {
  children: ReactNode;
  favorite?: boolean;
  onPress?: () => void;
  selected?: boolean | null;
  width: number;
}) => (
  <Overlay alignment={selected === null ? "topTrailing" : "bottomTrailing"}>
    <VStack
      alignment="leading"
      modifiers={[
        frame({ width }),
        background(
          tileBackground,
          shapes.roundedRectangle({
            cornerRadius: TILE_RADIUS,
            roundedCornerStyle: "continuous",
          })
        ),
        clipShape("roundedRectangle", TILE_RADIUS),
        contentShape(shapes.rectangle()),
        ...(onPress ? [onTapGesture(onPress)] : []),
      ]}
      spacing={0}
    >
      {children}
    </VStack>
    <Overlay.Content>
      {selected === null ? null : <SelectionMark selected={selected} />}
      {favorite && selected === null ? (
        <Image
          color="red"
          modifiers={[
            padding({ all: 10 }),
            shadow({ radius: 2, y: 1, color: "#00000033" }),
          ]}
          size={14}
          systemName="heart.fill"
        />
      ) : null}
    </Overlay.Content>
  </Overlay>
);

const TileText = ({
  children,
  lines = 2,
}: {
  children: string;
  lines?: number;
}) => (
  <Text
    modifiers={[
      roundedText(),
      lineLimit(lines),
      frame({ maxWidth: 10_000, alignment: "leading" }),
      padding({ horizontal: 14, vertical: 14 }),
    ]}
  >
    {children}
  </Text>
);

/** Remote media sized to the column, with a neutral box while it loads. */
const TileImage = ({
  card,
  contentFit = "cover",
  url,
  width,
}: {
  card: MobileCardSummary;
  contentFit?: "cover" | "contain";
  url?: string;
  width: number;
}) => {
  const height = Math.round(width / getTileImageRatio(card));
  // Remember a failed load so the tile shows the placeholder, not a blank box.
  const [failedUrl, setFailedUrl] = useState<string>();
  if (!url || failedUrl === url) {
    return (
      <VStack
        modifiers={[
          frame({ width, height }),
          background(PlatformColor("tertiarySystemFill"), shapes.rectangle()),
        ]}
      >
        <Image color="secondary" size={22} systemName="photo" />
      </VStack>
    );
  }
  return (
    <RNHostView matchContents>
      <ExpoImage
        cachePolicy="memory-disk"
        contentFit={contentFit}
        enforceEarlyResizing
        onError={() => setFailedUrl(url)}
        placeholder={card.placeholderUrl}
        recyclingKey={card._id}
        source={url}
        style={{
          backgroundColor: PlatformColor("tertiarySystemFill"),
          height,
          width,
        }}
        transition={150}
      />
    </RNHostView>
  );
};

const TileFooter = ({ icon, title }: { icon?: string; title: string }) => (
  <HStack modifiers={[padding({ horizontal: 14, vertical: 12 })]} spacing={8}>
    {icon ? (
      <Image color="secondary" size={14} systemName={icon as any} />
    ) : null}
    <Text modifiers={[roundedText(14), lineLimit(1)]}>{title}</Text>
    <Spacer />
  </HStack>
);

const QuoteMark = ({ side }: { side: "opening" | "closing" }) => (
  <Image
    color={PlatformColor("tertiaryLabel") as any}
    modifiers={[padding({ vertical: 8 })]}
    size={13}
    systemName={`quote.${side}`}
  />
);

/** The web card's deterministic waveform, drawn with native capsules. */
const Waveform = ({ seed, width }: { seed: string; width: number }) => {
  const inner = width - 28;
  const spacing = Math.max(
    1,
    (inner - WAVEFORM_BAR_COUNT * 2) / (WAVEFORM_BAR_COUNT - 1)
  );
  return (
    <HStack
      alignment="center"
      modifiers={[frame({ height: 56 }), padding({ horizontal: 14 })]}
      spacing={spacing}
    >
      {getWaveformHeights(seed).map((height, index) => (
        <Capsule
          // biome-ignore lint/suspicious/noArrayIndexKey: bars are fixed, ordered decoration
          key={index}
          modifiers={[
            frame({ width: 2, height: Math.round(height * 40) }),
            foregroundStyle({ type: "hierarchical", style: "secondary" }),
          ]}
        />
      ))}
    </HStack>
  );
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
  inTrash = false,
  isSelected = null,
  onDeleteForeverRequest,
  onPress,
  onDeleteRequest,
  onRestoreRequest,
  onSelectRequest,
  width,
}: CardItemProps) {
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
        const uri = await downloadNativeFile(url, name, "cache");

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            ...getNativeShareOptions(name),
            dialogTitle: "Save to Files",
          });
        }

        return;
      }

      const uri = await downloadNativeFile(url, name, "documents");
      Alert.alert("Downloaded", `Saved to ${uri}`);
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
      const uri = writeNativeCacheText(fileName, value);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, getNativeShareOptions(fileName));
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
      const uri = await downloadNativeFile(url, fileName, "cache");

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, getNativeShareOptions(fileName));
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

      return { hostname };
    } catch {
      return { hostname: card.url };
    }
  }, [card.url]);

  const imageUrl = getTileImageUrl(card);

  const surface = (content: ReactNode) => (
    <TileSurface
      favorite={card.isFavorited}
      onPress={onPress}
      selected={isSelected}
      width={width}
    >
      {content}
    </TileSurface>
  );

  const trashItems = [
    <Button
      key="restore"
      label="Restore"
      onPress={() => onRestoreRequest?.()}
      systemImage="arrow.uturn.backward"
    />,
    // biome-ignore lint/a11y/useValidAriaRole: expo-ui Button role maps to SwiftUI, not DOM ARIA
    <Button
      key="delete-forever"
      label="Delete Forever"
      onPress={() => onDeleteForeverRequest?.()}
      role="destructive"
      systemImage="trash"
    />,
  ];

  // While selecting, a tap toggles the card and the menu stays out of the way.
  const tile = (content: ReactNode, contextItems: ReactNode[]) =>
    isSelected === null ? (
      <ContextMenu>
        <ContextMenu.Items>
          {inTrash ? trashItems : contextItems}
          <Button
            label="Select"
            onPress={() => onSelectRequest?.()}
            systemImage="checkmark.circle"
          />
          {inTrash ? null : (
            // biome-ignore lint/a11y/useValidAriaRole: expo-ui Button role maps to SwiftUI, not DOM ARIA
            <Button
              label="Delete"
              onPress={handleDelete}
              role="destructive"
              systemImage="trash"
            />
          )}
        </ContextMenu.Items>
        <ContextMenu.Trigger>{surface(content)}</ContextMenu.Trigger>
      </ContextMenu>
    ) : (
      surface(content)
    );

  const fileActions = (key: string, name: string) => [
    <Button
      key={`download-${key}`}
      label="Download"
      onPress={() => void handleDownloadCard(name)}
      systemImage="arrow.down.circle"
    />,
    <Button
      key={`share-${key}`}
      label="Share"
      onPress={() => void handleShareCardFile(name)}
      systemImage="square.and.arrow.up"
    />,
  ];

  switch (card.type) {
    case "link": {
      const linkTitle = card.title || card.url || "Link";
      const actions = [
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
      ];
      if (imageUrl) {
        return tile(
          <>
            <TileImage card={card} url={imageUrl} width={width} />
            <Divider />
            <TileFooter title={linkTitle} />
          </>,
          actions
        );
      }
      return tile(
        <VStack
          alignment="leading"
          modifiers={[
            frame({ maxWidth: 10_000, alignment: "leading" }),
            padding({ horizontal: 14, vertical: 14 }),
          ]}
          spacing={4}
        >
          <Text modifiers={[roundedText(), lineLimit(2)]}>{linkTitle}</Text>
          {linkMeta?.hostname && linkMeta.hostname !== linkTitle ? (
            <Text
              modifiers={[
                roundedText(13, "regular"),
                foregroundStyle({ type: "hierarchical", style: "secondary" }),
                lineLimit(1),
              ]}
            >
              {linkMeta.hostname}
            </Text>
          ) : null}
        </VStack>,
        actions
      );
    }

    case "document": {
      const title = card.title || card.fileName || "Attachment";
      return tile(
        imageUrl ? (
          <>
            <TileImage
              card={card}
              contentFit="contain"
              url={imageUrl}
              width={width}
            />
            <Divider />
            <TileFooter icon="doc" title={title} />
          </>
        ) : (
          <TileFooter icon="doc" title={title} />
        ),
        fileActions("document", title)
      );
    }

    case "audio":
      return tile(
        <Waveform seed={card._id} width={width} />,
        fileActions("audio", card.fileName ?? "audio")
      );

    case "image": {
      const imageTitle = card.title || card.fileName || "Image";
      return tile(
        <TileImage card={card} url={imageUrl} width={width} />,
        fileActions("image", imageTitle)
      );
    }

    case "video": {
      const videoTitle = card.title || card.fileName || "Video";
      return tile(
        <Overlay alignment="center">
          {imageUrl ? (
            <TileImage card={card} url={imageUrl} width={width} />
          ) : (
            <Rectangle
              modifiers={[
                frame({
                  width,
                  height: Math.round(width / getTileImageRatio(card)),
                }),
                foregroundStyle("black"),
              ]}
            />
          )}
          <Overlay.Content>
            <Image
              color="white"
              modifiers={[
                frame({ width: 44, height: 44 }),
                glassEffect({ glass: { variant: "clear" }, shape: "circle" }),
              ]}
              size={18}
              systemName="play.fill"
            />
          </Overlay.Content>
        </Overlay>,
        fileActions("video", videoTitle)
      );
    }

    case "palette":
      return tile(
        card.colors?.length ? (
          <HStack modifiers={[frame({ width, height: 56 })]} spacing={0}>
            {card.colors.slice(0, 12).map((color) => (
              <Rectangle
                key={color}
                modifiers={[
                  frame({ maxWidth: 10_000, maxHeight: 10_000 }),
                  foregroundStyle(color as any),
                ]}
              />
            ))}
          </HStack>
        ) : (
          <TileText>{card.title}</TileText>
        ),
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

    case "quote": {
      const textContent = card.previewText || "Quote";
      return tile(
        <Overlay alignment="topLeading">
          <Text
            modifiers={[
              roundedText(),
              italic(),
              lineLimit(2),
              multilineTextAlignment("center"),
              frame({ maxWidth: 10_000 }),
              padding({ horizontal: 24, vertical: 18 }),
            ]}
          >
            {textContent}
          </Text>
          <Overlay.Content>
            <VStack
              modifiers={[
                frame({ maxWidth: 10_000, maxHeight: 10_000 }),
                padding({ horizontal: 8 }),
              ]}
            >
              <HStack>
                <QuoteMark side="opening" />
                <Spacer />
              </HStack>
              <Spacer />
              <HStack modifiers={[frame({ height: 20 })]}>
                <Spacer />
                <QuoteMark side="closing" />
              </HStack>
            </VStack>
          </Overlay.Content>
        </Overlay>,
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

    default: {
      const textContent = card.previewText || card.title || "Note";
      return tile(<TileText>{textContent}</TileText>, [
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
      ]);
    }
  }
});

export { CardItem };
