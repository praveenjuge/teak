import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "@/constants/colors";
import ConvexClientProvider from "../ConvexClientProvider";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth } from "convex/react";
import {
  ThemePreferenceProvider,
  useThemePreference,
} from "@/lib/theme-preference";
import { Keyboard } from "react-native";
import {
  BottomSheet,
  Host,
  Image,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  clearFeedbackStatus,
  getFeedbackStatus,
  subscribeFeedbackStatus,
  type FeedbackStatusPayload,
} from "@/lib/feedbackBridge";

void SplashScreen.preventAutoHideAsync();

const AUTO_DISMISS_MS = 2000;

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
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (isAuthenticated) {
      Keyboard.dismiss();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthLoading) {
      SplashScreen.hide();
    }
  }, [isAuthLoading]);

  if (isAuthLoading) {
    return null;
  }

  const initialRouteName = isAuthenticated ? "(tabs)" : "(auth)";

  return (
    <Stack
      initialRouteName={initialRouteName}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="(auth)"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}

function FeedbackBottomSheet() {
  const [feedbackState, setFeedbackState] =
    useState<FeedbackStatusPayload | null>(() => getFeedbackStatus());
  const isDismissingRef = useRef(false);

  const activeState = useMemo(() => feedbackState, [feedbackState]);

  const handleDismiss = useCallback(() => {
    if (isDismissingRef.current) {
      return;
    }
    isDismissingRef.current = true;
    clearFeedbackStatus();
    setFeedbackState(null);
  }, []);

  useEffect(() => {
    return subscribeFeedbackStatus((state) => {
      isDismissingRef.current = false;
      setFeedbackState(state);
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
      handleDismiss();
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [activeState, handleDismiss]);

  if (!activeState) return null;

  const { message, iconName } = activeState;

  return (
    <Host
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "box-none",
      }}
      useViewportSizeMeasurement
    >
      <BottomSheet
        isOpened={!!activeState}
        onIsOpenedChange={(open) => {
          if (!open) {
            handleDismiss();
          }
        }}
        presentationDetents={["medium"]}
        presentationDragIndicator="visible"
        interactiveDismissDisabled={false}
      >
        <VStack spacing={14} alignment="center">
          <Spacer />
          <Image systemName={(iconName ?? "checkmark.circle.fill") as any} />
          <Text weight="semibold" design="rounded" lineLimit={1}>
            {message}
          </Text>
          <Spacer />
        </VStack>
      </BottomSheet>
    </Host>
  );
}
