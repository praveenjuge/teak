import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import SplashScreenController from "@/app/splash";
import { colors } from "@/constants/colors";
import ConvexClientProvider from "../ConvexClientProvider";
import { useAuth } from "@clerk/clerk-expo";

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
    <ConvexClientProvider>
      <ThemeProvider
        value={colorScheme === "dark" ? CustomDarkTheme : CustomDefaultTheme}
      >
        <SplashScreenController />
        <RootNavigator />
        <StatusBar style="auto" />
      </ThemeProvider>
    </ConvexClientProvider>
  );
}

function RootNavigator() {
  const { userId } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!userId}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!userId}>
        <Stack.Screen
          name="(auth)/index"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="(auth)/sign-in"
          options={{
            headerShown: true,
            title: "Welcome Back",
            headerBackTitle: "Back",
          }}
        />
        <Stack.Screen
          name="(auth)/sign-up"
          options={{
            headerShown: true,
            title: "Create an Account",
            headerBackTitle: "Back",
          }}
        />
      </Stack.Protected>
    </Stack>
  );
}
