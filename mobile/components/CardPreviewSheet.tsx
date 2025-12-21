import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as RNImage, Linking, useWindowDimensions } from "react-native";
import { Audio } from "expo-av";
import { useEvent } from "expo";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  BottomSheet,
  Button,
  CircularProgress,
  Host,
  HStack,
  Image,
  List,
  RoundedRectangle,
  Section,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  cornerRadius,
  frame,
  foregroundStyle,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { Doc } from "@teak/convex/_generated/dataModel";

type Card = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
};

const unsupportedAudioMimes = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/x-opus+ogg",
  "audio/x-ogg",
]);

const unsupportedAudioExts = new Set(["webm", "ogg", "opus"]);

interface CardPreviewSheetProps {
  card: Card | null;
  isOpen: boolean;
  onClose: () => void;
}

const FullHeightPlaceholder = ({
  icon,
  label,
  height,
}: {
  icon: string;
  label: string;
  height: number;
}) => (
  <VStack
    spacing={12}
    alignment="center"
    modifiers={[frame({ height }), padding({ all: 16 })]}
  >
    <Spacer />
    <Image systemName={icon as any} size={28} color="secondary" />
    <Text color="secondary">{label}</Text>
    <Spacer />
  </VStack>
);

const FullHeightMedia = ({
  primaryUri,
  fallbackUri,
  height,
  fallbackIcon,
  fallbackLabel,
}: {
  primaryUri?: string | null;
  fallbackUri?: string | null;
  height: number;
  fallbackIcon: string;
  fallbackLabel: string;
}) => {
  const [activeUri, setActiveUri] = useState<string | null>(
    primaryUri ?? fallbackUri ?? null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setActiveUri(primaryUri ?? fallbackUri ?? null);
    setIsLoading(true);
    setHasError(false);
  }, [primaryUri, fallbackUri]);

  if (!activeUri || hasError) {
    return (
      <FullHeightPlaceholder
        icon={fallbackIcon}
        label={fallbackLabel}
        height={height}
      />
    );
  }

  const handleError = () => {
    if (activeUri === primaryUri && fallbackUri) {
      setActiveUri(fallbackUri);
      setIsLoading(true);
      return;
    }
    setIsLoading(false);
    setHasError(true);
  };

  return (
    <ZStack modifiers={[frame({ height })]}>
      <RNImage
        key={activeUri}
        source={{ uri: activeUri }}
        style={{
          width: "100%",
          height: "100%",
          opacity: isLoading ? 0 : 1,
        }}
        resizeMode="contain"
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        onError={handleError}
      />
      {isLoading ? <CircularProgress /> : null}
    </ZStack>
  );
};

const ActionButton = ({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) => (
  <Button
    variant="bordered"
    controlSize="large"
    onPress={onPress}
    disabled={disabled}
  >
    <HStack spacing={10} alignment="center">
      <Spacer />
      <Text color="primary" design="rounded">
        {label}
      </Text>
      <Spacer />
    </HStack>
  </Button>
);

const CenteredPanel = ({
  icon,
  title,
  subtitle,
  height,
  actionLabel,
  onAction,
  actionDisabled,
}: {
  icon: string;
  title: string;
  subtitle?: React.ReactNode;
  height: number;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}) => (
  <VStack
    spacing={12}
    alignment="center"
    modifiers={[frame({ height }), padding({ all: 16 })]}
  >
    <Spacer />
    <Image systemName={icon as any} size={28} color="secondary" />
    <Text weight="semibold">{title}</Text>
    {subtitle}
    <Spacer />
    {actionLabel && onAction ? (
      <ActionButton
        label={actionLabel}
        onPress={onAction}
        disabled={actionDisabled}
      />
    ) : null}
  </VStack>
);

const AudioPreview = ({
  title,
  height,
  isPlaying,
  isLoading,
  hasSource,
  onToggle,
}: {
  title: string;
  height: number;
  isPlaying: boolean;
  isLoading: boolean;
  hasSource: boolean;
  onToggle: () => void;
}) => {
  return (
    <VStack
      spacing={16}
      alignment="center"
      modifiers={[frame({ height }), padding({ all: 16 })]}
    >
      <Spacer />
      <Image
        systemName={
          (isPlaying ? "pause.circle.fill" : "play.circle.fill") as any
        }
        size={42}
        color="primary"
      />
      <Text weight="semibold">{title}</Text>
      <Button
        variant="bordered"
        controlSize="large"
        onPress={onToggle}
        disabled={!hasSource || isLoading}
      >
        <HStack spacing={10} alignment="center">
          <Spacer />
          <Text color="primary" design="rounded">
            {!hasSource
              ? "Audio unavailable"
              : isLoading
                ? "Loading..."
                : isPlaying
                  ? "Pause"
                  : "Play"}
          </Text>
          <Spacer />
        </HStack>
      </Button>
      <Spacer />
    </VStack>
  );
};

const chunkPalette = (items: NonNullable<Card["colors"]>, size: number) => {
  const rows: NonNullable<Card["colors"]>[] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
};

const VideoPreview = ({
  uri,
  height,
  isOpen,
}: {
  uri: string;
  height: number;
  isOpen: boolean;
}) => {
  const player = useVideoPlayer(uri);
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const isLoading = status === "loading" || status === "idle";

  useEffect(() => {
    const safePlay = () => {
      try {
        player.play();
      } catch (error) {
        console.warn("Failed to start video preview", error);
      }
    };

    const safePause = () => {
      try {
        player.pause();
      } catch (error) {
        console.warn("Failed to pause video preview", error);
      }
    };

    if (isOpen) {
      safePlay();
    } else {
      safePause();
    }

    return () => {
      safePause();
    };
  }, [isOpen, player]);

  return (
    <ZStack modifiers={[frame({ height })]}>
      <VideoView
        player={player}
        style={{ width: "100%", height: "100%" }}
        nativeControls
        contentFit="contain"
      />
      {isLoading ? <CircularProgress /> : null}
    </ZStack>
  );
};

function CardPreviewSheet({ card, isOpen, onClose }: CardPreviewSheetProps) {
  const { height } = useWindowDimensions();
  const isMediaFullHeight = card?.type === "image" || card?.type === "video";
  const sheetHeight = isMediaFullHeight
    ? height
    : Math.max(220, Math.round(height * 0.5));

  const audioUrl = card?.type === "audio" ? (card.fileUrl ?? null) : null;
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const audioMime = card?.fileMetadata?.mimeType?.toLowerCase();
  const audioExt = card?.fileMetadata?.fileName?.toLowerCase().split(".").pop();
  const isAudioSupported =
    (audioMime ? !unsupportedAudioMimes.has(audioMime) : true) &&
    (audioExt ? !unsupportedAudioExts.has(audioExt) : true);

  const stopAndUnloadAudio = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) {
      setIsAudioLoading(false);
      setIsAudioPlaying(false);
      setAudioError(null);
      return;
    }
    try {
      await sound.stopAsync();
    } catch (error) {
      console.warn("Failed to stop audio preview", error);
    }
    try {
      await sound.unloadAsync();
    } catch (error) {
      console.warn("Failed to unload audio preview", error);
    }
    soundRef.current = null;
    setIsAudioLoading(false);
    setIsAudioPlaying(false);
    setAudioError(null);
  }, []);

  const loadAndPlayAudio = useCallback(async () => {
    if (!audioUrl) return;
    if (!isAudioSupported) {
      setAudioError("Unsupported audio format");
      return;
    }
    await stopAndUnloadAudio();
    setIsAudioLoading(true);
    setAudioError(null);
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        playThroughEarpieceAndroid: false,
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) {
            setIsAudioLoading(false);
            setIsAudioPlaying(false);
            if (status.error) {
              setAudioError(status.error);
            }
            return;
          }
          setIsAudioLoading(status.isBuffering ?? false);
          setIsAudioPlaying(status.isPlaying ?? false);
        },
        true
      );
      soundRef.current = sound;
    } catch (error) {
      console.warn("Failed to load audio preview", error);
      setIsAudioLoading(false);
      setIsAudioPlaying(false);
      setAudioError("Failed to load audio");
    }
  }, [audioUrl, isAudioSupported, stopAndUnloadAudio]);

  useEffect(() => {
    if (card?.type !== "audio") {
      void stopAndUnloadAudio();
      return;
    }
    if (!audioUrl) {
      void stopAndUnloadAudio();
      return;
    }
    if (isOpen) {
      void loadAndPlayAudio();
    } else {
      void stopAndUnloadAudio();
    }
  }, [isOpen, card?.type, audioUrl, loadAndPlayAudio, stopAndUnloadAudio]);

  useEffect(() => {
    return () => {
      void stopAndUnloadAudio();
    };
  }, [stopAndUnloadAudio]);

  const handleToggleAudio = useCallback(async () => {
    if (!audioUrl || !isAudioSupported) return;
    const sound = soundRef.current;
    if (!sound) {
      await loadAndPlayAudio();
      return;
    }
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) {
        await loadAndPlayAudio();
        return;
      }
      if (status.isPlaying) {
        await sound.pauseAsync();
      } else {
        await sound.playAsync();
      }
    } catch (error) {
      console.warn("Failed to toggle audio preview", error);
    }
  }, [audioUrl, isAudioSupported, loadAndPlayAudio]);

  const handleOpenLink = useCallback(async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch (error) {
      console.error("Failed to open URL:", error);
    }
  }, []);

  const paletteRows = useMemo(() => {
    if (!card?.colors?.length) return [];
    return chunkPalette(card.colors.slice(0, 12), 6);
  }, [card?.colors]);

  if (!card) return null;

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
  const quoteText = `"${textContent}"`;
  const renderTextBlock = (value: string) => (
    <VStack modifiers={[frame({ height: sheetHeight })]}>
      <List>
        <Section>
          <Text>{value}</Text>
        </Section>
      </List>
    </VStack>
  );

  const renderBody = () => {
    switch (card.type) {
      case "image":
        return (
          <FullHeightMedia
            primaryUri={imageUrl}
            fallbackUri={imageFallback}
            height={sheetHeight}
            fallbackIcon="photo"
            fallbackLabel="Image unavailable"
          />
        );
      case "video":
        if (!card.fileUrl) {
          return (
            <FullHeightMedia
              primaryUri={videoPoster}
              height={sheetHeight}
              fallbackIcon="play.rectangle"
              fallbackLabel="Video preview unavailable"
            />
          );
        }
        return (
          <VideoPreview
            uri={card.fileUrl}
            height={sheetHeight}
            isOpen={isOpen}
          />
        );
      case "text":
        return renderTextBlock(textContent);
      case "quote": {
        return renderTextBlock(quoteText);
      }
      case "palette":
        if (!paletteRows.length) {
          return (
            <FullHeightPlaceholder
              icon="paintpalette"
              label="No colors saved"
              height={sheetHeight}
            />
          );
        }
        return (
          <VStack
            spacing={16}
            alignment="center"
            modifiers={[frame({ height: sheetHeight }), padding({ all: 16 })]}
          >
            {paletteRows.map((row, rowIndex) => (
              <HStack key={`row-${rowIndex}`} spacing={10}>
                {row.map((color, index) => (
                  <RoundedRectangle
                    key={`${color.hex}-${index}`}
                    modifiers={[
                      frame({ width: 36, height: 36 }),
                      foregroundStyle(color.hex as any),
                      cornerRadius(8),
                    ]}
                  />
                ))}
              </HStack>
            ))}
          </VStack>
        );
      case "audio":
        if (!audioUrl || audioError || !isAudioSupported) {
          return (
            <CenteredPanel
              icon="waveform"
              title="Audio"
              height={sheetHeight}
              subtitle={
                <Text color="secondary">
                  {audioError ||
                    (audioUrl
                      ? "Unsupported audio format"
                      : "Audio unavailable")}
                </Text>
              }
              actionLabel={audioUrl ? "Open link" : undefined}
              onAction={
                audioUrl ? () => void handleOpenLink(audioUrl) : undefined
              }
            />
          );
        }
        return (
          <AudioPreview
            title={card.metadataTitle || "Audio"}
            height={sheetHeight}
            isPlaying={isAudioPlaying}
            isLoading={isAudioLoading}
            hasSource={!!audioUrl}
            onToggle={handleToggleAudio}
          />
        );
      case "link":
        return (
          <CenteredPanel
            icon="link"
            title={linkTitle}
            height={sheetHeight}
            subtitle={
              linkUrl ? (
                <Text color="secondary" lineLimit={2}>
                  {linkUrl}
                </Text>
              ) : undefined
            }
            actionLabel="Open link"
            onAction={linkUrl ? () => void handleOpenLink(linkUrl) : undefined}
            actionDisabled={!linkUrl}
          />
        );
      case "document":
      default:
        return (
          <CenteredPanel
            icon="doc.text"
            title={title}
            height={sheetHeight}
            subtitle={
              card.fileMetadata?.mimeType ? (
                <Text color="secondary">{card.fileMetadata.mimeType}</Text>
              ) : undefined
            }
            actionLabel={card.type === "document" ? "Open link" : undefined}
            onAction={
              card.type === "document" && documentUrl
                ? () => void handleOpenLink(documentUrl)
                : undefined
            }
            actionDisabled={!documentUrl}
          />
        );
    }
  };

  return (
    <Host
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: isOpen ? "auto" : "none",
      }}
      useViewportSizeMeasurement
    >
      <BottomSheet
        isOpened={isOpen}
        onIsOpenedChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        presentationDetents={isMediaFullHeight ? ["large"] : ["medium"]}
        presentationDragIndicator="visible"
        interactiveDismissDisabled={false}
      >
        {renderBody()}
      </BottomSheet>
    </Host>
  );
}

export { CardPreviewSheet };
