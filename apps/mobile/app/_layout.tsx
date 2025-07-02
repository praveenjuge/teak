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

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <SplashScreenController />
        <RootNavigator />
      </AuthProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { data: session } = authClient.useSession();
  const sessionPresent = session ? true : false;

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
