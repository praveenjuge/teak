import { Stack } from "expo-router";
import React from "react";
import { authClient } from "@/lib/auth-client";
import SplashScreenController from "@/app/splash";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { useAppStateFocus } from "@/lib/query-setup";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <SplashScreenController />
        <RootNavigator />
        <StatusBar style="auto" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function RootNavigator() {
  const { data } = authClient.useSession();
  const sessionPresent = data ? true : false;

  // Setup React Native optimizations for TanStack Query
  useAppStateFocus();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={sessionPresent}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!sessionPresent}>
        <Stack.Screen
          name="(auth)/login"
          options={{
            headerShown: true,
            title: "Welcome to Teak",
          }}
        />
      </Stack.Protected>
    </Stack>
  );
}
