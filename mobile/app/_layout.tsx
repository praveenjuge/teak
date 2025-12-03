import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "@/constants/colors";
import ConvexClientProvider from "../ConvexClientProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { authClient } from "@/lib/auth-client";
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
        <ShareIntentProvider
          options={{
            debug: __DEV__,
            resetOnBackground: true,
          }}
        >
          <ThemeProvider value={isDark ? CustomDarkTheme : CustomDefaultTheme}>
            <RootNavigator />
            <ShareIntentNavigator />
            <StatusBar style={isDark ? "light" : "dark"} />
          </ThemeProvider>
        </ShareIntentProvider>
      </ConvexClientProvider>
    </ErrorBoundary>
  );
}

function RootNavigator() {
  const { data: session, isPending } = authClient.useSession();
  const isSignedIn = Boolean(session);
  useEffect(() => {
    if (isSignedIn) {
      Keyboard.dismiss();
    }
  }, [isSignedIn]);

  useEffect(() => {
    if (!isPending) {
      SplashScreen.hide();
    }
  }, [isPending]);

  if (isPending) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" redirect={!isSignedIn} />
      <Stack.Screen
        name="(feedback)/index"
        options={{
          headerShown: true,
          presentation: "modal",
          headerBackTitle: "Close",
          headerBackVisible: true,
        }}
        redirect={!isSignedIn}
      />
      <Stack.Screen
        name="(auth)/index"
        options={{
          headerShown: false,
        }}
        redirect={isSignedIn}
      />
      <Stack.Screen
        name="(auth)/sign-in"
        options={{
          headerShown: true,
          title: "Welcome Back",
          headerBackTitle: "Back",
          presentation: "modal",
        }}
        redirect={isSignedIn}
      />
      <Stack.Screen
        name="(auth)/sign-up"
        options={{
          headerShown: true,
          title: "Create an Account",
          headerBackTitle: "Back",
          presentation: "modal",
        }}
        redirect={isSignedIn}
      />
    </Stack>
  );
}

function ShareIntentNavigator() {
  const { hasShareIntent } = useShareIntentContext();
  const router = useRouter();
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    if (hasShareIntent && !hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      router.replace("/shareintent" as Href);
    } else if (!hasShareIntent) {
      hasRedirectedRef.current = false;
    }
  }, [hasShareIntent, router]);

  return null;
}
