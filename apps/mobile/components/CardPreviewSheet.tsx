import {
  Button,
  Circle,
  ContentUnavailableView,
  HStack,
  List,
  Spacer,
  Text,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listStyle,
  scrollDisabled,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { useEvent } from "expo";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useCallback, useEffect } from "react";
import { Linking } from "react-native";
import {
  FullHeightMedia,
  VideoPreview,
} from "@/components/card-preview/preview-sections";
import { colors } from "@/constants/colors";

type Card = Doc<"cards"> & {
  fileUrl?: string;
  screenshotUrl?: string;
  thumbnailUrl?: string;
};

interface CardPreviewSheetProps {
  card: Card;
  isOpen: boolean;
}

const unsupportedAudioMimes = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/x-opus+ogg",
  "audio/x-ogg",
]);

const unsupportedAudioExts = new Set(["webm", "ogg", "opus"]);
const PREVIEW_HEIGHT = 260;

function CardPreviewSheet({ card, isOpen }: CardPreviewSheetProps) {
  const audioUrl = card?.type === "audio" ? (card.fileUrl ?? null) : null;

  const audioMime = card?.fileMetadata?.mimeType?.toLowerCase();
  const audioExt = card?.fileMetadata?.fileName?.toLowerCase().split(".").pop();
  const isAudioSupported =
    (audioMime ? !unsupportedAudioMimes.has(audioMime) : true) &&
    (audioExt ? !unsupportedAudioExts.has(audioExt) : true);

  const audioSource = audioUrl && isAudioSupported ? { uri: audioUrl } : null;
  const player = useAudioPlayer(audioSource);
  const { playing: isAudioPlaying, isLoaded } = useEvent(
    player,
    "playbackStatusUpdate",
    player.currentStatus
  );
  const isAudioLoading = !isLoaded;

  useEffect(() => {
    if (audioSource) {
      void setAudioModeAsync({ playsInSilentMode: true });
    }
  }, [audioSource]);

  useEffect(() => {
    if (card?.type !== "audio" || !audioSource) {
      return;
    }

    if (!isOpen) {
      player.pause();
      player.seekTo(0);
    }
  }, [isOpen, card?.type, audioSource, player]);

  const handleToggleAudio = useCallback(() => {
    if (!audioSource) {
      return;
    }

    if (isAudioPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }, [audioSource, isAudioPlaying, player]);

  const handleOpenLink = useCallback(async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch (error) {
      console.error(
        "Failed to open URL:",
        error instanceof Error ? error.message : error
      );
    }
  }, []);

  const textContent = card.content?.trim() || "No content";
  const title =
    card.metadataTitle || card.fileMetadata?.fileName || "Attachment";
  const imageUrl = card.fileUrl ?? null;
  const imageFallback = card.thumbnailUrl ?? card.screenshotUrl ?? null;
  const videoPoster = card.thumbnailUrl ?? card.screenshotUrl;
  const documentUrl = card.fileUrl ?? card.url ?? null;
  const linkTitle =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview.title || card.url || "Link"
      : card.metadataTitle || card.url || "Link";
  const linkUrl = card.url ?? "";

  const renderActionButton = (
    label: string,
    onPress: () => void,
    options?: { disabled?: boolean; destructive?: boolean }
  ) => (
    <Button
      modifiers={[
        buttonStyle("borderedProminent"),
        controlSize("large"),
        tint(colors.primary),
        disabledModifier(options?.disabled ?? false),
      ]}
      onPress={onPress}
    >
      <HStack alignment="center" spacing={10}>
        <Spacer />
        <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
          {label}
        </Text>
        <Spacer />
      </HStack>
    </Button>
  );

  const renderBody = () => {
    switch (card.type) {
      case "image":
        return (
          <List modifiers={[listStyle("plain")]}>
            <FullHeightMedia
              fallbackIcon="photo"
              fallbackLabel="Image unavailable"
              fallbackUri={imageFallback}
              height={PREVIEW_HEIGHT}
              primaryUri={imageUrl}
            />
          </List>
        );
      case "video":
        return (
          <List modifiers={[listStyle("plain")]}>
            {card.fileUrl ? (
              <VideoPreview
                height={PREVIEW_HEIGHT}
                isOpen={isOpen}
                posterUri={videoPoster}
                uri={card.fileUrl}
              />
            ) : (
              <FullHeightMedia
                fallbackIcon="play.rectangle"
                fallbackLabel="Video preview unavailable"
                height={PREVIEW_HEIGHT}
                primaryUri={videoPoster}
              />
            )}
          </List>
        );
      case "text":
        return (
          <List modifiers={[listStyle("plain")]}>
            <Text>{textContent}</Text>
          </List>
        );
      case "quote":
        return (
          <List modifiers={[listStyle("plain")]}>
            <Text
              modifiers={[font({ design: "serif" })]}
            >{`"${textContent}"`}</Text>
          </List>
        );
      case "palette":
        return (
          <List modifiers={[listStyle("plain"), scrollDisabled()]}>
            {card.colors?.length ? (
              card.colors.slice(0, 12).map((color) => (
                <HStack alignment="center" key={color.hex} spacing={12}>
                  <Circle
                    modifiers={[
                      frame({ height: 22, width: 22 }),
                      foregroundStyle(color.hex as any),
                    ]}
                  />
                  <Text modifiers={[font({ design: "rounded" })]}>
                    {color.hex}
                  </Text>
                  <Spacer />
                </HStack>
              ))
            ) : (
              <ContentUnavailableView
                description="Save a palette card with extracted colors to preview them here."
                systemImage="plus.circle"
                title="No colors saved"
              />
            )}
          </List>
        );
      case "audio":
        return (
          <List modifiers={[listStyle("plain"), scrollDisabled()]}>
            {audioUrl && isAudioSupported ? (
              <>
                <HStack alignment="center">
                  <Text modifiers={[font({ weight: "semibold" })]}>
                    {card.metadataTitle || "Audio"}
                  </Text>
                  <Spacer />
                  <Text
                    modifiers={[
                      foregroundStyle({
                        type: "hierarchical",
                        style: "secondary",
                      }),
                    ]}
                  >
                    {isAudioLoading
                      ? "Loading..."
                      : isAudioPlaying
                        ? "Playing"
                        : "Paused"}
                  </Text>
                </HStack>
                {renderActionButton(
                  isAudioLoading
                    ? "Loading..."
                    : isAudioPlaying
                      ? "Pause"
                      : "Play",
                  handleToggleAudio,
                  { disabled: isAudioLoading }
                )}
              </>
            ) : (
              <>
                <Text
                  modifiers={[
                    foregroundStyle({
                      type: "hierarchical",
                      style: "secondary",
                    }),
                  ]}
                >
                  {audioUrl ? "Unsupported audio format" : "Audio unavailable"}
                </Text>
                {audioUrl
                  ? renderActionButton("Open File", () => {
                      void handleOpenLink(audioUrl);
                    })
                  : null}
              </>
            )}
          </List>
        );
      case "link":
        return (
          <List modifiers={[listStyle("plain"), scrollDisabled()]}>
            <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
              {linkTitle}
            </Text>
            {linkUrl ? (
              <Text
                modifiers={[
                  foregroundStyle({
                    type: "hierarchical",
                    style: "secondary",
                  }),
                  lineLimit(2),
                ]}
              >
                {linkUrl}
              </Text>
            ) : (
              <Text
                modifiers={[
                  foregroundStyle({
                    type: "hierarchical",
                    style: "secondary",
                  }),
                  font({ design: "rounded" }),
                ]}
              >
                Link unavailable
              </Text>
            )}
            {linkUrl
              ? renderActionButton("Open Link", () => {
                  void handleOpenLink(linkUrl);
                })
              : null}
          </List>
        );
      default:
        return (
          <List modifiers={[listStyle("plain"), scrollDisabled()]}>
            <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
              {title}
            </Text>
            {card.fileMetadata?.mimeType ? (
              <Text
                modifiers={[
                  foregroundStyle({
                    type: "hierarchical",
                    style: "secondary",
                  }),
                  font({ design: "rounded" }),
                ]}
              >
                {card.fileMetadata.mimeType}
              </Text>
            ) : null}
            {card.type === "document" && documentUrl
              ? renderActionButton("Open File", () => {
                  void handleOpenLink(documentUrl);
                })
              : null}
          </List>
        );
    }
  };

  return renderBody();
}

export { CardPreviewSheet };
