import {
  Button,
  ContentUnavailableView,
  HStack,
  Image,
  RoundedRectangle,
  Spacer,
  VStack,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  cornerRadius,
  disabled as disabledModifier,
  foregroundStyle,
  frame,
} from "@expo/ui/swift-ui/modifiers";
import { useEvent } from "expo";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useCallback, useEffect } from "react";
import {
  FullHeightMedia,
  FullHeightPlaceholder,
  VideoPreview,
} from "@/components/card-preview/preview-sections";
import { SheetText } from "@/components/card-sheet/SheetText";
import type { CardSheetDetail } from "@/lib/card-sheet";
import { getMobileFilePreview } from "@/lib/files";

const COMPACT_PREVIEW_HEIGHT = 220;

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

  const audioSource = audioUrl && isSupported ? { uri: audioUrl } : null;
  const player = useAudioPlayer(audioSource);
  const { playing: isPlaying, isLoaded } = useEvent(
    player,
    "playbackStatusUpdate",
    player.currentStatus
  );

  useEffect(() => {
    if (audioSource) {
      void setAudioModeAsync({ playsInSilentMode: true });
    }
  }, [audioSource]);

  useEffect(() => {
    if (!audioSource) {
      return;
    }
    if (!isOpen) {
      player.pause();
      player.seekTo(0);
    }
  }, [isOpen, audioSource, player]);

  let audioStatusLabel = "Loading...";
  if (isLoaded) {
    audioStatusLabel = isPlaying ? "Playing" : "Paused";
  }

  const handleToggle = useCallback(() => {
    if (!audioSource) {
      return;
    }
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }, [audioSource, isPlaying, player]);

  if (!(audioUrl && isSupported)) {
    return (
      <FullHeightPlaceholder
        height={COMPACT_PREVIEW_HEIGHT}
        icon="music.note"
        label={audioUrl ? "Unsupported audio format" : "Audio unavailable"}
      />
    );
  }

  return (
    <HStack alignment="center" spacing={12}>
      <Button
        modifiers={[
          buttonStyle("bordered"),
          controlSize("large"),
          disabledModifier(!isLoaded),
        ]}
        onPress={handleToggle}
      >
        <Image
          size={20}
          systemName={(isPlaying ? "pause.fill" : "play.fill") as any}
        />
      </Button>
      <VStack alignment="leading" spacing={2}>
        <SheetText weight="semibold">
          {card.metadataTitle || card.fileMetadata?.fileName || "Audio"}
        </SheetText>
        <SheetText secondary size={13}>
          {audioStatusLabel}
        </SheetText>
      </VStack>
      <Spacer />
    </HStack>
  );
}

function PaletteStrip({ card }: { card: CardSheetDetail }) {
  if (!card.colors?.length) {
    return (
      <ContentUnavailableView
        description="Save a palette card with extracted colors to preview them here."
        systemImage="plus.circle"
        title="No colors saved"
      />
    );
  }

  const swatches = card.colors.slice(0, 12);

  return (
    <VStack alignment="leading" spacing={8}>
      <HStack spacing={6}>
        {swatches.map((color) => (
          <RoundedRectangle
            key={color.hex}
            modifiers={[
              frame({ height: 44 }),
              foregroundStyle(color.hex as any),
              cornerRadius(8),
            ]}
          />
        ))}
      </HStack>
      <SheetText limit={2} secondary size={13}>
        {swatches.map((color) => color.hex).join(" · ")}
      </SheetText>
    </VStack>
  );
}

function PreviewSection({ card, isOpen }: PreviewSectionProps) {
  const textContent = card.content?.trim() || "No content";
  const title =
    card.metadataTitle || card.fileMetadata?.fileName || "Attachment";
  const videoPoster = card.thumbnailUrl ?? card.screenshotUrl;
  const linkTitle =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview.title || card.url || "Link"
      : card.metadataTitle || card.url || "Link";
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

  switch (card.type) {
    case "image":
      return (
        <FullHeightMedia
          fallbackIcon="photo"
          fallbackLabel="Image unavailable"
          fallbackUri={filePreview.imageFallback}
          height={COMPACT_PREVIEW_HEIGHT}
          primaryUri={filePreview.imagePrimary}
        />
      );
    case "video":
      if (filePreview.isAnimatedGif) {
        return (
          <FullHeightMedia
            fallbackIcon="photo.on.rectangle.angled"
            fallbackLabel="Animated preview unavailable"
            height={COMPACT_PREVIEW_HEIGHT}
            primaryUri={card.fileUrl}
          />
        );
      }
      if (!card.fileUrl) {
        return (
          <FullHeightMedia
            fallbackIcon="play.rectangle"
            fallbackLabel="Video preview unavailable"
            height={COMPACT_PREVIEW_HEIGHT}
            primaryUri={videoPoster}
          />
        );
      }
      return (
        <VideoPreview
          height={COMPACT_PREVIEW_HEIGHT}
          isOpen={isOpen}
          posterUri={videoPoster}
          uri={card.fileUrl}
        />
      );
    case "text":
      return <SheetText selectable>{textContent}</SheetText>;
    case "quote":
      return <SheetText selectable>{`"${textContent}"`}</SheetText>;
    case "palette":
      return <PaletteStrip card={card} />;
    case "audio":
      return <AudioPreviewRow card={card} isOpen={isOpen} />;
    case "link":
      return (
        <VStack alignment="leading" spacing={4}>
          <SheetText weight="semibold">{linkTitle}</SheetText>
          {card.url ? (
            <SheetText limit={2} secondary size={13}>
              {card.url}
            </SheetText>
          ) : (
            <SheetText secondary>Link unavailable</SheetText>
          )}
        </VStack>
      );
    default:
      return (
        <VStack alignment="leading" spacing={4}>
          <SheetText weight="semibold">{title}</SheetText>
          {card.fileMetadata?.mimeType ? (
            <SheetText secondary size={13}>
              {card.fileMetadata.mimeType}
            </SheetText>
          ) : null}
          {filePreview.facts.length > 0 ? (
            <SheetText secondary size={13}>
              {filePreview.facts.join(" · ")}
            </SheetText>
          ) : null}
        </VStack>
      );
  }
}

export { PreviewSection };
