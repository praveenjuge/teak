import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "@/constants/colors";
import ConvexClientProvider from "../ConvexClientProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useConvexAuth } from "convex/react";
import {
  ThemePreferenceProvider,
  useThemePreference,
} from "@/lib/theme-preference";
import { Keyboard } from "react-native";

void SplashScreen.preventAutoHideAsync();

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
        <ThemeProvider value={isDark ? CustomDarkTheme : CustomDefaultTheme}>
          <RootNavigator />
          <StatusBar style={isDark ? "light" : "dark"} />
        </ThemeProvider>
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

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" redirect={!isAuthenticated} />
      <Stack.Screen
        name="(feedback)/index"
        options={{
          headerShown: true,
          presentation: "modal",
          headerBackTitle: "Close",
          headerBackVisible: true,
        }}
        redirect={!isAuthenticated}
      />
      <Stack.Screen
        name="(auth)/index"
        options={{
          headerShown: false,
        }}
        redirect={isAuthenticated}
      />
      <Stack.Screen
        name="(auth)/sign-in"
        options={{
          headerShown: true,
          title: "Welcome Back",
          headerBackTitle: "Back",
          presentation: "modal",
        }}
        redirect={isAuthenticated}
      />
      <Stack.Screen
        name="(auth)/sign-up"
        options={{
          headerShown: true,
          title: "Create an Account",
          headerBackTitle: "Back",
          presentation: "modal",
        }}
        redirect={isAuthenticated}
      />
    </Stack>
  );
}
