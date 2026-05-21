import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { Stack, usePathname } from "expo-router";
import {
  hide as hideSplashScreen,
  preventAutoHideAsync,
} from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { colors } from "@/constants/colors";
import { Sentry } from "@/lib/sentry";
import { INCOMING_SHARE_SCREEN } from "@/lib/share/constants";
import {
  ThemePreferenceProvider,
  useThemePreference,
} from "@/lib/theme-preference";
import { useAuthBootstrap } from "@/lib/use-auth-bootstrap";
import ConvexClientProvider from "../ConvexClientProvider";

void preventAutoHideAsync();

const customDefaultTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
  },
};

const customDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
  },
};

function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <RootLayoutContent />
    </ThemePreferenceProvider>
  );
}

export default Sentry.wrap(RootLayout);

function RootLayoutContent() {
  const { isLoaded, resolvedScheme } = useThemePreference();
  const isDark = resolvedScheme === "dark";
  const hasHiddenSplash = useRef(false);
  const pathname = usePathname();
  const previousPathname = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
    }
  }, [pathname]);

  useEffect(() => {
    if (!isLoaded || hasHiddenSplash.current) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      void hideSplashScreen();
      hasHiddenSplash.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [isLoaded]);

  if (!isLoaded) {
    return null;
  }

  return (
    <ErrorBoundary>
      <ConvexClientProvider>
        <ConvexQueryCacheProvider>
          <ThemeProvider value={isDark ? customDarkTheme : customDefaultTheme}>
            <RootNavigator />
            <StatusBar style={isDark ? "light" : "dark"} />
          </ThemeProvider>
        </ConvexQueryCacheProvider>
      </ConvexClientProvider>
    </ErrorBoundary>
  );
}

function RootNavigator() {
  const { isLoading, isAuthenticated, routeState } = useAuthBootstrap();

  if (isLoading) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="loading" />
      </Stack>
    );
  }

  if (routeState === "offline") {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="offline" />
      </Stack>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Auth routes - only accessible when NOT authenticated */}
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      {/* Share extension - accessible to all */}
      <Stack.Screen
        name={INCOMING_SHARE_SCREEN}
        options={{
          sheetGrabberVisible: true,
          headerShown: true,
          title: "Save to Teak",
          presentation: "formSheet",
        }}
      />

      {/* Protected routes - only accessible when authenticated */}
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
    </Stack>
  );
}
