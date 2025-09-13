import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { colors } from "@/constants/colors";
import ConvexClientProvider from "../ConvexClientProvider";
import { useAuth } from "@clerk/clerk-expo";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

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
        <ThemeProvider
          value={colorScheme === "dark" ? CustomDarkTheme : CustomDefaultTheme}
        >
          <RootNavigator />
          <StatusBar style="auto" />
        </ThemeProvider>
      </ConvexClientProvider>
    </ErrorBoundary>
  );
}

function RootNavigator() {
  const { isSignedIn, isLoaded } = useAuth();

  useEffect(() => {
    if (isLoaded) {
      SplashScreen.hide();
    }
  }, [isLoaded]);

  if (!isLoaded) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" redirect={!isSignedIn} />
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
