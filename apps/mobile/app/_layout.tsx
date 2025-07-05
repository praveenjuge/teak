import { Stack } from "expo-router";
import React from "react";
import { authClient } from "@/lib/auth-client";
import SplashScreenController from "@/app/splash";
import { AuthProvider } from "@/lib/AuthContext";
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
        <AuthProvider>
          <SplashScreenController />
          <RootNavigator />
        </AuthProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function RootNavigator() {
  const { data: session, isPending, error } = authClient.useSession();
  const sessionPresent = session ? true : false;

  console.log('[RootLayout] Session state:', { 
    session: session ? 'present' : 'null', 
    sessionPresent, 
    isPending, 
    error: error ? error.message : null,
    userId: session?.user?.id || null
  });

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
