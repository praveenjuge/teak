import { Stack } from "expo-router";
import React from "react";
import { authClient } from "../lib/auth-client";
import SplashScreenController from "./splash";
import { AuthProvider } from "../lib/AuthContext";

export default function RootLayout() {
  return (
    <AuthProvider>
      <SplashScreenController />
      <RootNavigator />
    </AuthProvider>
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
