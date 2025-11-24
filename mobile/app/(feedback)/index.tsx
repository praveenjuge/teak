import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { colors } from "@/constants/colors";
import {
  clearFeedbackStatus,
  getFeedbackStatus,
  subscribeFeedbackStatus,
  type FeedbackStatusPayload,
} from "@/lib/feedbackBridge";

const AUTO_DISMISS_MS = 5000;

type StatusParams = {
  message?: string;
  title?: string;
  iconName?: string;
  accentColor?: string;
  dismissAfterMs?: string;
};

export default function FeedbackStatusScreen() {
  const params = useLocalSearchParams<StatusParams>();

  const paramsState = useMemo<FeedbackStatusPayload | null>(() => {
    const message =
      typeof params.message === "string" ? params.message : undefined;

    if (!message) {
      return null;
    }

    const dismissAfterMs =
      typeof params.dismissAfterMs === "string" &&
      params.dismissAfterMs.trim().length > 0
        ? Number(params.dismissAfterMs)
        : undefined;

    return {
      message,
      title: typeof params.title === "string" ? params.title : undefined,
      iconName:
        typeof params.iconName === "string"
          ? (params.iconName as never)
          : undefined,
      accentColor:
        typeof params.accentColor === "string" ? params.accentColor : undefined,
      dismissAfterMs: Number.isNaN(dismissAfterMs) ? undefined : dismissAfterMs,
    };
  }, [params]);

  const [feedbackState, setFeedbackState] =
    useState<FeedbackStatusPayload | null>(
      () => getFeedbackStatus() ?? paramsState
    );
  const colorScheme = useColorScheme();
  const isDismissingRef = useRef(false);

  const handleDismiss = useCallback(() => {
    if (isDismissingRef.current) {
      return;
    }
    isDismissingRef.current = true;
    clearFeedbackStatus();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)");
  }, [router]);

  useEffect(() => {
    return subscribeFeedbackStatus((state) => {
      if (state) {
        isDismissingRef.current = false;
        setFeedbackState(state);
      } else {
        setFeedbackState(null);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      isDismissingRef.current = false;
      clearFeedbackStatus();
    };
  }, []);

  const activeState = feedbackState ?? paramsState;

  useEffect(() => {
    if (!activeState?.message) {
      return;
    }

    const dismissAfterMs = activeState.dismissAfterMs;
    const autoDismissInterval =
      typeof dismissAfterMs === "number" && !Number.isNaN(dismissAfterMs)
        ? dismissAfterMs
        : undefined;

    AccessibilityInfo.announceForAccessibility?.(activeState.message);

    if (autoDismissInterval === -1) {
      return;
    }

    const timeoutMs = autoDismissInterval ?? AUTO_DISMISS_MS;

    const timer = setTimeout(() => {
      handleDismiss();
    }, timeoutMs);

    return () => {
      clearTimeout(timer);
    };
  }, [activeState, handleDismiss]);

  useEffect(() => {
    if (!activeState?.message) {
      handleDismiss();
    }
  }, [activeState?.message, handleDismiss]);

  if (!activeState?.message) {
    return null;
  }

  const { message, title, iconName, accentColor } = activeState;

  const resolvedIconName = iconName as
    | Parameters<typeof IconSymbol>[0]["name"]
    | undefined;

  return (
    <>
      <StatusBar
        barStyle={colorScheme === "dark" ? "light-content" : "dark-content"}
      />
      <Stack.Screen
        options={{
          title: message,
        }}
      />
      <StatusOverlay
        accentColor={accentColor}
        colorScheme={colorScheme}
        iconName={resolvedIconName}
        message={message}
        onDismiss={handleDismiss}
        title={title}
      />
    </>
  );
}

type StatusOverlayProps = {
  title?: string;
  message: string;
  onDismiss?: () => void;
  iconName?: Parameters<typeof IconSymbol>[0]["name"];
  accentColor?: string;
  colorScheme: ReturnType<typeof useColorScheme>;
};

const DEFAULT_ICON = "checkmark.circle.fill" as const;

function StatusOverlay({
  message,
  iconName = DEFAULT_ICON,
  accentColor = colors.primary,
  colorScheme,
}: StatusOverlayProps) {
  const resolvedAccent =
    accentColor ??
    (colorScheme === "dark" ? colors.systemGreen : colors.primary);

  return (
    <View style={styles.content}>
      <IconSymbol
        color={resolvedAccent}
        name={iconName}
        size={72}
        weight="semibold"
      />
      <Text style={styles.titleText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingVertical: 8,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  titleText: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: "600",
    color: colors.label,
  },
});
