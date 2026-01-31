// @ts-expect-error - @expo/ui internal import not exported
import { Circle } from "@expo/ui/src/swift-ui/Shapes";
import {
  BottomSheet,
  Button,
  CircularProgress,
  Host,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import { foregroundStyle, frame, padding } from "@expo/ui/swift-ui/modifiers";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { useEvent } from "expo";
import { Audio } from "expo-av";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Image as RNImage, useWindowDimensions } from "react-native";

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
    alignment="center"
    modifiers={[frame({ height }), padding({ all: 16 })]}
    spacing={12}
  >
    <Spacer />
    <Image color="secondary" size={28} systemName={icon as any} />
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
  // Show thumbnail immediately while full image loads
  const [activeUri, setActiveUri] = useState<string | null>(
    fallbackUri ?? primaryUri ?? null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const isPrimary = activeUri === primaryUri;

  useEffect(() => {
    // Start with thumbnail, then load full image
    if (fallbackUri) {
      setActiveUri(fallbackUri);
    }
    if (primaryUri) {
      setActiveUri(primaryUri);
    }
    setIsLoading(true);
    setHasError(false);
  }, [primaryUri, fallbackUri]);

  if (!activeUri || hasError) {
    return (
      <FullHeightPlaceholder
        height={height}
        icon={fallbackIcon}
        label={fallbackLabel}
      />
    );
  }

  const handleError = () => {
    if (activeUri === primaryUri && fallbackUri) {
      setActiveUri(fallbackUri);
      setIsLoading(false);
      return;
    }
    setIsLoading(false);
    setHasError(true);
  };

  return (
    <ZStack modifiers={[frame({ height })]}>
      <RNImage
        key={activeUri}
        onError={handleError}
        onLoadEnd={() => setIsLoading(false)}
        onLoadStart={() => isPrimary && setIsLoading(true)}
        resizeMode="contain"
        source={{ uri: activeUri, cache: "force-cache" }}
        style={{
          width: "100%",
          height: "100%",
        }}
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
    controlSize="large"
    disabled={disabled}
    onPress={onPress}
    variant="bordered"
  >
    <HStack alignment="center" spacing={10}>
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
    alignment="center"
    modifiers={[frame({ height }), padding({ all: 16 })]}
    spacing={12}
  >
    <Spacer />
    <Image color="secondary" size={28} systemName={icon as any} />
    <Text weight="semibold">{title}</Text>
    {subtitle}
    <Spacer />
    {actionLabel && onAction ? (
      <ActionButton
        disabled={actionDisabled}
        label={actionLabel}
        onPress={onAction}
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
      alignment="center"
      modifiers={[frame({ height }), padding({ all: 16 })]}
      spacing={16}
    >
      <Spacer />
      <Image
        color="primary"
        size={42}
        systemName={
          (isPlaying ? "pause.circle.fill" : "play.circle.fill") as any
        }
      />
      <Text weight="semibold">{title}</Text>
      <Button
        controlSize="large"
        disabled={!hasSource || isLoading}
        onPress={onToggle}
        variant="bordered"
      >
        <HStack alignment="center" spacing={10}>
          <Spacer />
          <Text color="primary" design="rounded">
            {hasSource
              ? isLoading
                ? "Loading..."
                : isPlaying
                  ? "Pause"
                  : "Play"
              : "Audio unavailable"}
          </Text>
          <Spacer />
        </HStack>
      </Button>
      <Spacer />
    </VStack>
  );
};

const VideoPreview = ({
  uri,
  height,
  isOpen,
  posterUri,
}: {
  uri: string;
  height: number;
  isOpen: boolean;
  posterUri?: string | null;
}) => {
  const player = useVideoPlayer(uri);
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const isLoading = status === "loading" || status === "idle";
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);

  useEffect(() => {
    const safePlay = () => {
      try {
        player.play();
        setHasStartedPlaying(true);
      } catch (error) {
        console.warn(
          "Failed to start video preview:",
          error instanceof Error ? error.message : error
        );
      }
    };

    const safePause = () => {
      try {
        player.pause();
      } catch (error) {
        console.warn(
          "Failed to pause video preview:",
          error instanceof Error ? error.message : error
        );
      }
    };

    if (isOpen) {
      safePlay();
    } else {
      safePause();
      setHasStartedPlaying(false);
    }

    return () => {
      safePause();
    };
  }, [isOpen, player]);

  return (
    <ZStack modifiers={[frame({ height })]}>
      {/* Show poster while video loads */}
      {posterUri && !hasStartedPlaying ? (
        <RNImage
          resizeMode="contain"
          source={{ uri: posterUri, cache: "force-cache" }}
          style={{ width: "100%", height: "100%" }}
        />
      ) : null}
      <VideoView
        contentFit="contain"
        nativeControls
        player={player}
        style={{ width: "100%", height: "100%" }}
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
      console.warn(
        "Failed to stop audio preview:",
        error instanceof Error ? error.message : error
      );
    }
    try {
      await sound.unloadAsync();
    } catch (error) {
      console.warn(
        "Failed to unload audio preview:",
        error instanceof Error ? error.message : error
      );
    }
    soundRef.current = null;
    setIsAudioLoading(false);
    setIsAudioPlaying(false);
    setAudioError(null);
  }, []);

  const loadAndPlayAudio = useCallback(async () => {
    if (!audioUrl) {
      return;
    }
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
      console.warn(
        "Failed to load audio preview:",
        error instanceof Error ? error.message : error
      );
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
    if (!(audioUrl && isAudioSupported)) {
      return;
    }
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
      console.warn(
        "Failed to toggle audio preview:",
        error instanceof Error ? error.message : error
      );
    }
  }, [audioUrl, isAudioSupported, loadAndPlayAudio]);

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

  if (!card) {
    return null;
  }

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
            fallbackIcon="photo"
            fallbackLabel="Image unavailable"
            fallbackUri={imageFallback}
            height={sheetHeight}
            primaryUri={imageUrl}
          />
        );
      case "video":
        if (!card.fileUrl) {
          return (
            <FullHeightMedia
              fallbackIcon="play.rectangle"
              fallbackLabel="Video preview unavailable"
              height={sheetHeight}
              primaryUri={videoPoster}
            />
          );
        }
        return (
          <VideoPreview
            height={sheetHeight}
            isOpen={isOpen}
            posterUri={videoPoster}
            uri={card.fileUrl}
          />
        );
      case "text":
        return renderTextBlock(textContent);
      case "quote": {
        return renderTextBlock(quoteText);
      }
      case "palette":
        if (!card.colors?.length) {
          return (
            <FullHeightPlaceholder
              height={sheetHeight}
              icon="paintpalette"
              label="No colors saved"
            />
          );
        }
        return (
          <VStack modifiers={[frame({ height: sheetHeight })]}>
            <List listStyle="insetGrouped">
              {card.colors.slice(0, 12).map((color, index) => (
                <HStack
                  alignment="center"
                  key={`${color.hex}-${index}`}
                  spacing={12}
                >
                  <Circle
                    modifiers={[
                      frame({ width: 32, height: 32 }),
                      foregroundStyle(color.hex as any),
                    ]}
                  />
                  <Text>{color.hex}</Text>
                  <Spacer />
                </HStack>
              ))}
            </List>
          </VStack>
        );
      case "audio":
        if (!audioUrl || audioError || !isAudioSupported) {
          return (
            <CenteredPanel
              actionLabel={audioUrl ? "Open link" : undefined}
              height={sheetHeight}
              icon="waveform"
              onAction={
                audioUrl ? () => void handleOpenLink(audioUrl) : undefined
              }
              subtitle={
                <Text color="secondary">
                  {audioError ||
                    (audioUrl
                      ? "Unsupported audio format"
                      : "Audio unavailable")}
                </Text>
              }
              title="Audio"
            />
          );
        }
        return (
          <AudioPreview
            hasSource={!!audioUrl}
            height={sheetHeight}
            isLoading={isAudioLoading}
            isPlaying={isAudioPlaying}
            onToggle={handleToggleAudio}
            title={card.metadataTitle || "Audio"}
          />
        );
      case "link":
        return (
          <CenteredPanel
            actionDisabled={!linkUrl}
            actionLabel="Open link"
            height={sheetHeight}
            icon="link"
            onAction={linkUrl ? () => void handleOpenLink(linkUrl) : undefined}
            subtitle={
              linkUrl ? (
                <Text color="secondary" lineLimit={2}>
                  {linkUrl}
                </Text>
              ) : undefined
            }
            title={linkTitle}
          />
        );
      default:
        return (
          <CenteredPanel
            actionDisabled={!documentUrl}
            actionLabel={card.type === "document" ? "Open link" : undefined}
            height={sheetHeight}
            icon="doc.text"
            onAction={
              card.type === "document" && documentUrl
                ? () => void handleOpenLink(documentUrl)
                : undefined
            }
            subtitle={
              card.fileMetadata?.mimeType ? (
                <Text color="secondary">{card.fileMetadata.mimeType}</Text>
              ) : undefined
            }
            title={title}
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
        interactiveDismissDisabled={false}
        isOpened={isOpen}
        onIsOpenedChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        presentationDetents={isMediaFullHeight ? ["large"] : ["medium"]}
        presentationDragIndicator="visible"
      >
        {renderBody()}
      </BottomSheet>
    </Host>
  );
}

export { CardPreviewSheet };
