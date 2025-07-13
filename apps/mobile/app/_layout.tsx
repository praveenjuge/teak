import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { useColorScheme } from 'react-native';
import SplashScreenController from '@/app/splash';
import { colors } from '@/constants/colors';
import { authClient } from '@/lib/auth-client';
import { queryClient } from '@/lib/query-client';
import { useAppStateFocus } from '@/lib/query-setup';

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
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        value={colorScheme === 'dark' ? CustomDarkTheme : CustomDefaultTheme}
      >
        <SplashScreenController />
        <RootNavigator />
        <StatusBar style="auto" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function RootNavigator() {
  const sessionData = authClient ? authClient.useSession() : { data: null };
  const sessionPresent = sessionData.data ? true : false;

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
            title: 'Welcome to Teak',
          }}
        />
      </Stack.Protected>
    </Stack>
  );
}
