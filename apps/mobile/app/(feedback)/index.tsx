import { useCallback, useEffect } from "react";
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

const AUTO_DISMISS_MS = 5000;

type StatusParams = {
  message?: string;
  title?: string;
  iconName?: string;
  accentColor?: string;
};

export default function FeedbackStatusScreen() {
  const params = useLocalSearchParams<StatusParams>();

  const message =
    typeof params.message === "string" ? params.message : undefined;
  const title = typeof params.title === "string" ? params.title : undefined;
  const iconName =
    typeof params.iconName === "string"
      ? (params.iconName as never)
      : undefined;
  const accentColor =
    typeof params.accentColor === "string" ? params.accentColor : undefined;
  const colorScheme = useColorScheme();

  const handleDismiss = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)");
  }, []);

  useEffect(() => {
    if (!message) {
      handleDismiss();
      return;
    }

    AccessibilityInfo.announceForAccessibility?.(message);

    const timer = setTimeout(() => {
      handleDismiss();
    }, AUTO_DISMISS_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [handleDismiss, message]);

  if (!message) {
    return null;
  }

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
        iconName={iconName}
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

const DEFAULT_TITLE = "Success";
const DEFAULT_ICON = "checkmark.circle.fill" as const;

function StatusOverlay({
  title = DEFAULT_TITLE,
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
      <Text style={styles.titleText}>{title}</Text>
      <Text style={styles.messageText}>{message}</Text>
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
  messageText: {
    fontSize: 16,
    textAlign: "center",
    color: colors.secondaryLabel,
  },
});
