import {
  Button,
  HStack,
  Image,
  ProgressView,
  RNHostView,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Image as RNImage } from "react-native";

export const FullHeightPlaceholder = ({
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
    <Text
      modifiers={[
        foregroundStyle({ type: "hierarchical", style: "secondary" }),
      ]}
    >
      {label}
    </Text>
    <Spacer />
  </VStack>
);

export const FullHeightMedia = ({
  primaryUri,
  fallbackUri,
  height,
  fallbackIcon,
  fallbackLabel,
}: {
  primaryUri?: string | null;
  fallbackIcon: string;
  fallbackLabel: string;
  fallbackUri?: string | null;
  height: number;
}) => {
  const [activeUri, setActiveUri] = useState<string | null>(
    fallbackUri ?? primaryUri ?? null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setActiveUri(primaryUri ?? fallbackUri ?? null);
    setIsLoading(true);
    setHasError(false);
  }, [fallbackUri, primaryUri]);

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
      <RNHostView>
        <RNImage
          key={activeUri}
          onError={handleError}
          onLoadEnd={() => setIsLoading(false)}
          onLoadStart={() => setIsLoading(true)}
          resizeMode="contain"
          source={{ uri: activeUri, cache: "force-cache" }}
          style={{
            height: "100%",
            width: "100%",
          }}
        />
      </RNHostView>
      {isLoading ? <ProgressView /> : null}
    </ZStack>
  );
};

const ActionButton = ({
  label,
  onPress,
  disabled,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) => (
  <Button
    modifiers={[
      buttonStyle("bordered"),
      controlSize("large"),
      disabledModifier(disabled),
    ]}
    onPress={onPress}
  >
    <HStack alignment="center" spacing={10}>
      <Spacer />
      <Text
        modifiers={[
          foregroundStyle({ type: "hierarchical", style: "primary" }),
          font({ design: "rounded" }),
        ]}
      >
        {label}
      </Text>
      <Spacer />
    </HStack>
  </Button>
);

export const CenteredPanel = ({
  icon,
  title,
  subtitle,
  height,
  actionLabel,
  onAction,
  actionDisabled,
}: {
  actionDisabled?: boolean;
  actionLabel?: string;
  height: number;
  icon: string;
  onAction?: () => void;
  subtitle?: React.ReactNode;
  title: string;
}) => (
  <VStack
    alignment="center"
    modifiers={[frame({ height }), padding({ all: 16 })]}
    spacing={12}
  >
    <Spacer />
    <Image color="secondary" size={28} systemName={icon as any} />
    <Text modifiers={[font({ weight: "semibold" })]}>{title}</Text>
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

export const AudioPreview = ({
  title,
  height,
  isPlaying,
  isLoading,
  hasSource,
  onToggle,
}: {
  hasSource: boolean;
  height: number;
  isLoading: boolean;
  isPlaying: boolean;
  onToggle: () => void;
  title: string;
}) => (
  <VStack
    alignment="center"
    modifiers={[frame({ height }), padding({ all: 16 })]}
    spacing={16}
  >
    <Spacer />
    <Image
      color="primary"
      size={42}
      systemName={(isPlaying ? "pause.circle.fill" : "play.circle.fill") as any}
    />
    <Text modifiers={[font({ weight: "semibold" })]}>{title}</Text>
    <Button
      modifiers={[
        buttonStyle("bordered"),
        controlSize("large"),
        disabledModifier(!hasSource || isLoading),
      ]}
      onPress={onToggle}
    >
      <HStack alignment="center" spacing={10}>
        <Spacer />
        <Text
          modifiers={[
            foregroundStyle({ type: "hierarchical", style: "primary" }),
            font({ design: "rounded" }),
          ]}
        >
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

export const VideoPreview = ({
  uri,
  height,
  isOpen,
  posterUri,
}: {
  height: number;
  isOpen: boolean;
  posterUri?: string | null;
  uri: string;
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
      {posterUri && !hasStartedPlaying ? (
        <RNHostView>
          <RNImage
            resizeMode="contain"
            source={{ uri: posterUri, cache: "force-cache" }}
            style={{ height: "100%", width: "100%" }}
          />
        </RNHostView>
      ) : null}
      <RNHostView>
        <VideoView
          contentFit="contain"
          nativeControls
          player={player}
          style={{ height: "100%", width: "100%" }}
        />
      </RNHostView>
      {isLoading ? <ProgressView /> : null}
    </ZStack>
  );
};
