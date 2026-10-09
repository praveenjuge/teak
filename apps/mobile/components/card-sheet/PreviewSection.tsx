import {
  Button,
  Capsule,
  HStack,
  Image,
  Overlay,
  Rectangle,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  contentShape,
  controlSize,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  listRowInsets,
  monospacedDigit,
  multilineTextAlignment,
  onTapGesture,
  padding,
  shapes,
  textSelection,
} from "@expo/ui/swift-ui/modifiers";
import { useEvent } from "expo";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useCallback, useEffect, useMemo } from "react";
import { PlatformColor, useWindowDimensions } from "react-native";
import {
  FullHeightMedia,
  FullHeightPlaceholder,
  VideoPreview,
} from "@/components/card-preview/preview-sections";
import { SheetText } from "@/components/card-sheet/SheetText";
import { copyTextToClipboard } from "@/lib/card-actions";
import { getWaveformHeights, WAVEFORM_BAR_COUNT } from "@/lib/card-grid";
import { type CardSheetDetail, formatFileSize } from "@/lib/card-sheet";
import { getMobileFilePreview } from "@/lib/files";
import { triggerSuccessHaptic } from "@/lib/haptics";

/** Inset-grouped rows sit 20pt in from each edge of the sheet. */
const ROW_INSET = 20;
const MAX_MEDIA_HEIGHT = 440;
const PLACEHOLDER_HEIGHT = 200;
const SWATCH_MIN_WIDTH = 84;
const SWATCH_HEIGHT = 128;
const WWW_PREFIX_REGEX = /^www\./;

const unsupportedAudioMimes = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/x-opus+ogg",
  "audio/x-ogg",
]);

const unsupportedAudioExts = new Set(["webm", "ogg", "opus"]);

interface PreviewSectionProps {
  card: CardSheetDetail;
  isOpen: boolean;
}

const useRowWidth = () => useWindowDimensions().width - ROW_INSET * 2;

/** Height that shows the whole image at the row's width, capped for tall media. */
const mediaHeight = (rowWidth: number, width?: number, height?: number) => {
  const ratio = width && height ? width / height : 4 / 3;
  return Math.round(Math.min(rowWidth / ratio, MAX_MEDIA_HEIGHT));
};

const formatTime = (seconds: number) => {
  if (!(Number.isFinite(seconds) && seconds >= 0)) {
    return "0:00";
  }
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const hostnameOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(WWW_PREFIX_REGEX, "") : null;
  } catch {
    return null;
  }
};

function AudioPreviewRow({
  card,
  isOpen,
}: {
  card: CardSheetDetail;
  isOpen: boolean;
}) {
  const audioUrl = card.fileUrl ?? null;
  const audioMime = card.fileMetadata?.mimeType?.toLowerCase();
  const audioExt = card.fileMetadata?.fileName?.toLowerCase().split(".").pop();
  const isMimeSupported = !(audioMime && unsupportedAudioMimes.has(audioMime));
  const isExtSupported = !(audioExt && unsupportedAudioExts.has(audioExt));
  const isSupported = isMimeSupported && isExtSupported;

  const audioSource = useMemo(
    () => (audioUrl && isSupported ? { uri: audioUrl } : null),
    [audioUrl, isSupported]
  );
  const player = useAudioPlayer(audioSource, { updateInterval: 250 });
  const status = useEvent(player, "playbackStatusUpdate", player.currentStatus);
  const isPlaying = status.playing;
  const duration =
    status.duration > 0 ? status.duration : (card.fileMetadata?.duration ?? 0);
  const progress =
    duration > 0 ? Math.min(status.currentTime / duration, 1) : 0;
  const playedBars = Math.round(progress * WAVEFORM_BAR_COUNT);

  useEffect(() => {
    if (audioSource) {
      void setAudioModeAsync({ playsInSilentMode: true });
    }
  }, [audioSource]);

  useEffect(() => {
    if (audioSource && !isOpen) {
      player.pause();
      player.seekTo(0);
    }
  }, [isOpen, audioSource, player]);

  const handleToggle = useCallback(() => {
    if (!audioSource) {
      return;
    }
    if (isPlaying) {
      player.pause();
    } else {
      if (duration > 0 && status.currentTime >= duration) {
        player.seekTo(0);
      }
      player.play();
    }
  }, [audioSource, duration, isPlaying, player, status.currentTime]);

  if (!(audioUrl && isSupported)) {
    return (
      <FullHeightPlaceholder
        height={PLACEHOLDER_HEIGHT}
        icon="waveform"
        label={
          audioUrl
            ? "This recording format can't play on iPhone"
            : "Audio unavailable"
        }
      />
    );
  }

  const started = status.currentTime > 0 || isPlaying;
  const timeLabel = started
    ? `${formatTime(status.currentTime)} / ${formatTime(duration)}`
    : formatTime(duration);

  return (
    <VStack
      alignment="leading"
      modifiers={[padding({ vertical: 8 })]}
      spacing={12}
    >
      <HStack alignment="center" spacing={12}>
        <Button
          modifiers={[
            buttonStyle("glass"),
            buttonBorderShape("circle"),
            controlSize("large"),
            disabledModifier(!status.isLoaded),
            accessibilityLabel(isPlaying ? "Pause" : "Play"),
          ]}
          onPress={handleToggle}
        >
          <Image
            color={PlatformColor("label") as any}
            size={18}
            systemName={(isPlaying ? "pause.fill" : "play.fill") as any}
          />
        </Button>
        <HStack
          alignment="center"
          modifiers={[frame({ height: 36 })]}
          spacing={2}
        >
          {getWaveformHeights(card._id).map((height, index) => (
            <Capsule
              // biome-ignore lint/suspicious/noArrayIndexKey: bars are fixed, ordered decoration
              key={index}
              modifiers={[
                frame({ width: 2, height: Math.round(height * 36) }),
                foregroundStyle(
                  index < playedBars
                    ? { type: "hierarchical", style: "primary" }
                    : { type: "hierarchical", style: "tertiary" }
                ),
              ]}
            />
          ))}
        </HStack>
        <Spacer />
        <Text
          modifiers={[
            font({ design: "rounded", size: 13 }),
            monospacedDigit(),
            foregroundStyle({ type: "hierarchical", style: "secondary" }),
          ]}
        >
          {timeLabel}
        </Text>
      </HStack>
    </VStack>
  );
}

/** Wide swatches with glass hex labels, like the web card; tap one to copy. */
function PaletteSwatches({ card }: { card: CardSheetDetail }) {
  const rowWidth = useRowWidth();
  const swatches = card.colors?.slice(0, 12) ?? [];

  if (swatches.length === 0) {
    return (
      <FullHeightPlaceholder
        height={PLACEHOLDER_HEIGHT}
        icon="paintpalette"
        label="No colors saved"
      />
    );
  }

  // As many swatches per row as fit, then balanced so no row is left nearly empty.
  const maxPerRow = Math.max(
    1,
    Math.min(swatches.length, Math.floor(rowWidth / SWATCH_MIN_WIDTH))
  );
  const rowCount = Math.ceil(swatches.length / maxPerRow);
  const perRow = Math.ceil(swatches.length / rowCount);
  const rows: (typeof swatches)[] = [];
  for (let index = 0; index < swatches.length; index += perRow) {
    rows.push(swatches.slice(index, index + perRow));
  }

  const copy = (hex: string) => {
    void copyTextToClipboard(hex).then(() => triggerSuccessHaptic());
  };

  return (
    <VStack
      modifiers={[
        listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 }),
      ]}
      spacing={0}
    >
      {rows.map((row) => (
        <HStack key={row.map((color) => color.hex).join()} spacing={0}>
          {row.map((color) => (
            <Overlay alignment="bottom" key={color.hex}>
              <Rectangle
                modifiers={[
                  frame({ maxWidth: 10_000, height: SWATCH_HEIGHT }),
                  foregroundStyle(color.hex as any),
                  contentShape(shapes.rectangle()),
                  onTapGesture(() => copy(color.hex)),
                  accessibilityLabel(`Copy ${color.hex}`),
                ]}
              />
              <Overlay.Content>
                <Text
                  modifiers={[
                    font({ design: "rounded", size: 12, weight: "semibold" }),
                    monospacedDigit(),
                    padding({ horizontal: 8, vertical: 5 }),
                    glassEffect({
                      glass: { variant: "regular" },
                      shape: "capsule",
                    }),
                    padding({ bottom: 10 }),
                  ]}
                >
                  {color.hex.toUpperCase()}
                </Text>
              </Overlay.Content>
            </Overlay>
          ))}
        </HStack>
      ))}
    </VStack>
  );
}

function QuotePreview({ text }: { text: string }) {
  return (
    <VStack
      alignment="center"
      modifiers={[padding({ horizontal: 8, vertical: 20 })]}
      spacing={4}
    >
      <Image
        color={PlatformColor("tertiaryLabel") as any}
        modifiers={[padding({ bottom: 8 })]}
        size={22}
        systemName="quote.opening"
      />
      <Text
        modifiers={[
          font({ design: "rounded", size: 22, weight: "medium" }),
          multilineTextAlignment("center"),
          textSelection(true),
        ]}
      >
        {text}
      </Text>
    </VStack>
  );
}

function LinkPreview({ card }: { card: CardSheetDetail }) {
  const rowWidth = useRowWidth();
  const preview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const title = preview?.title || card.metadataTitle || card.url || "Link";
  const description = preview?.description || card.metadataDescription;
  const host = hostnameOf(card.url);
  const imageUrl = card.linkPreviewImageUrl ?? card.screenshotUrl;
  const usesScreenshot = !card.linkPreviewImageUrl;

  return (
    <VStack alignment="leading" spacing={0}>
      {imageUrl ? (
        <FullHeightMedia
          fallbackIcon="link"
          fallbackLabel="Preview unavailable"
          height={mediaHeight(
            rowWidth,
            usesScreenshot ? preview?.screenshotWidth : preview?.imageWidth,
            usesScreenshot ? preview?.screenshotHeight : preview?.imageHeight
          )}
          primaryUri={imageUrl}
        />
      ) : null}
      <VStack
        alignment="leading"
        modifiers={[padding({ top: imageUrl ? 14 : 4, bottom: 4 })]}
        spacing={6}
      >
        <SheetText limit={3} size={17} weight="semibold">
          {title}
        </SheetText>
        {host ? (
          <HStack spacing={6}>
            <Image color="secondary" size={12} systemName="globe" />
            <SheetText limit={1} secondary size={14}>
              {host}
            </SheetText>
          </HStack>
        ) : null}
        {description ? (
          <SheetText limit={3} secondary size={14}>
            {description}
          </SheetText>
        ) : null}
      </VStack>
    </VStack>
  );
}

function PreviewSection({ card, isOpen }: PreviewSectionProps) {
  const rowWidth = useRowWidth();
  const textContent = card.content?.trim() || "No content";
  const title =
    card.metadataTitle || card.fileMetadata?.fileName || "Attachment";
  const videoPoster = card.thumbnailUrl ?? card.screenshotUrl;
  const fileHeight = mediaHeight(
    rowWidth,
    card.fileMetadata?.width,
    card.fileMetadata?.height
  );
  const filePreview = getMobileFilePreview({
    fileKind: card.fileMetadata?.kind,
    fileLanguage: card.fileMetadata?.language,
    fileName: card.fileMetadata?.fileName,
    detailUrl: card.detailUrl,
    fileUrl: card.fileUrl,
    mimeType: card.fileMetadata?.mimeType,
    preview: card.fileMetadata?.preview,
    screenshotUrl: card.screenshotUrl,
    thumbnailUrl: card.thumbnailUrl,
  });
  // "PDF · 4.6 MB", then anything extra like page or word counts.
  const fileSize = card.fileMetadata?.fileSize;
  const documentFacts = [
    filePreview.format?.extension.split(".").pop()?.toUpperCase(),
    typeof fileSize === "number" ? formatFileSize(fileSize) : null,
    ...filePreview.facts.filter((fact) => fact !== card.fileMetadata?.kind),
  ].filter((fact): fact is string => Boolean(fact));

  switch (card.type) {
    case "image":
      return (
        <FullHeightMedia
          fallbackIcon="photo"
          fallbackLabel="Image unavailable"
          fallbackUri={filePreview.imageFallback}
          height={fileHeight}
          primaryUri={filePreview.imagePrimary}
        />
      );
    case "video":
      if (filePreview.isAnimatedGif) {
        return (
          <FullHeightMedia
            fallbackIcon="photo.on.rectangle.angled"
            fallbackLabel="Animated preview unavailable"
            fallbackUri={videoPoster}
            height={fileHeight}
            primaryUri={card.fileUrl}
          />
        );
      }
      if (!card.fileUrl) {
        return (
          <FullHeightMedia
            fallbackIcon="play.rectangle"
            fallbackLabel="Video preview unavailable"
            height={fileHeight}
            primaryUri={videoPoster}
          />
        );
      }
      return (
        <VideoPreview
          height={fileHeight}
          isOpen={isOpen}
          posterUri={videoPoster}
          uri={card.fileUrl}
        />
      );
    case "text":
      return (
        <VStack modifiers={[padding({ vertical: 6 })]}>
          <SheetText selectable size={17}>
            {textContent}
          </SheetText>
        </VStack>
      );
    case "quote":
      return <QuotePreview text={textContent} />;
    case "palette":
      return <PaletteSwatches card={card} />;
    case "audio":
      return <AudioPreviewRow card={card} isOpen={isOpen} />;
    case "link":
      return <LinkPreview card={card} />;
    default:
      return (
        <VStack alignment="leading" spacing={0}>
          {filePreview.imagePrimary || card.thumbnailUrl ? (
            <FullHeightMedia
              fallbackIcon="doc"
              fallbackLabel="Preview unavailable"
              fallbackUri={filePreview.imageFallback}
              height={fileHeight}
              primaryUri={filePreview.imagePrimary ?? card.thumbnailUrl}
            />
          ) : null}
          <HStack modifiers={[padding({ top: 12, bottom: 4 })]} spacing={10}>
            <Image color="secondary" size={18} systemName="doc" />
            <VStack alignment="leading" spacing={2}>
              <SheetText limit={2} weight="semibold">
                {title}
              </SheetText>
              {documentFacts.length > 0 ? (
                <SheetText secondary size={13}>
                  {documentFacts.join(" · ")}
                </SheetText>
              ) : null}
            </VStack>
            <Spacer />
          </HStack>
        </VStack>
      );
  }
}

export { PreviewSection };
