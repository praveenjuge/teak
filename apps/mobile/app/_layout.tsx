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
import { useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { colors } from "@/constants/colors";
import { INCOMING_SHARE_SCREEN } from "@/lib/share/constants";
import {
  ThemePreferenceProvider,
  useThemePreference,
} from "@/lib/theme-preference";
import ConvexClientProvider from "../ConvexClientProvider";

void preventAutoHideAsync();

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
        <Stack.Screen name="loading" />
      </Stack>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen
        name={INCOMING_SHARE_SCREEN}
        options={{
          sheetGrabberVisible: true,
          headerShown: true,
          title: "Save to Teak",
          presentation: "formSheet",
        }}
      />
      <Stack.Protected guard={isAuthenticated && !isLoading}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
    </Stack>
  );
}
