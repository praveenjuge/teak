import {
  BottomSheet,
  Host,
  Image,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useConvexAuth } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { Stack } from "expo-router";
import {
  hide as hideSplashScreen,
  preventAutoHideAsync,
} from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { colors } from "@/constants/colors";
import {
  clearFeedbackStatus,
  type FeedbackStatusPayload,
  getFeedbackStatus,
  subscribeFeedbackStatus,
} from "@/lib/feedbackBridge";
import {
  ThemePreferenceProvider,
  useThemePreference,
} from "@/lib/theme-preference";
import ConvexClientProvider from "../ConvexClientProvider";

void preventAutoHideAsync();
const AUTO_DISMISS_MS = 2000;
const DISMISS_ANIMATION_MS = 350;

export default function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <RootLayoutContent />
    </ThemePreferenceProvider>
  );
}

function RootLayoutContent() {
  const { resolvedScheme } = useThemePreference();
  const isDark = resolvedScheme === "dark";

  // Create custom theme with our primary color
  const CustomDefaultTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: colors.primary,
    },
  };

  const CustomDarkTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: colors.primary,
    },
  };

  return (
    <ErrorBoundary>
      <ConvexClientProvider>
        <ConvexQueryCacheProvider>
          <ThemeProvider value={isDark ? CustomDarkTheme : CustomDefaultTheme}>
            <RootNavigator />
            <FeedbackBottomSheet />
            <StatusBar style={isDark ? "light" : "dark"} />
          </ThemeProvider>
        </ConvexQueryCacheProvider>
      </ConvexClientProvider>
    </ErrorBoundary>
  );
}

function RootNavigator() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isLoading) {
      hideSplashScreen();
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(loading)" />
      </Stack>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Protected guard={isAuthenticated && !isLoading}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
    </Stack>
  );
}

function FeedbackBottomSheet() {
  const [feedbackState, setFeedbackState] =
    useState<FeedbackStatusPayload | null>(() => getFeedbackStatus());
  const [isSheetOpen, setIsSheetOpen] = useState<boolean>(() =>
    Boolean(getFeedbackStatus())
  );
  const isDismissingRef = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeState = useMemo(() => feedbackState, [feedbackState]);

  const finalizeDismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setFeedbackState(null);
    clearFeedbackStatus();
    isDismissingRef.current = false;
  }, []);

  const beginDismiss = useCallback(() => {
    if (isDismissingRef.current) {
      return;
    }
    isDismissingRef.current = true;
    setIsSheetOpen(false);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }
    dismissTimerRef.current = setTimeout(() => {
      finalizeDismiss();
    }, DISMISS_ANIMATION_MS);
  }, [finalizeDismiss]);

  useEffect(() => {
    return subscribeFeedbackStatus((state) => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      isDismissingRef.current = false;
      setFeedbackState(state);
      setIsSheetOpen(Boolean(state));
    });
  }, []);

  useEffect(() => {
    if (!activeState?.message) {
      return;
    }

    const dismissAfterMs = activeState.dismissAfterMs;
    const autoDismissInterval =
      typeof dismissAfterMs === "number" && !Number.isNaN(dismissAfterMs)
        ? dismissAfterMs
        : undefined;

    if (autoDismissInterval === -1) {
      return;
    }

    const timeoutMs = autoDismissInterval ?? AUTO_DISMISS_MS;

    const timer = setTimeout(() => {
      beginDismiss();
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [activeState, beginDismiss]);

  if (!activeState) {
    return null;
  }

  const { message, iconName } = activeState;

  return (
    <Host
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: isSheetOpen ? "box-none" : "none",
      }}
      useViewportSizeMeasurement
    >
      <BottomSheet
        interactiveDismissDisabled={false}
        isOpened={isSheetOpen}
        onIsOpenedChange={(open) => {
          if (open) {
            setIsSheetOpen(true);
            return;
          }
          finalizeDismiss();
        }}
        presentationDetents={["medium"]}
        presentationDragIndicator="visible"
      >
        <VStack alignment="center" spacing={14}>
          <Spacer />
          <Image systemName={(iconName ?? "checkmark.circle.fill") as any} />
          <Text design="rounded" lineLimit={1} weight="semibold">
            {message}
          </Text>
          <Spacer />
        </VStack>
      </BottomSheet>
    </Host>
  );
}
