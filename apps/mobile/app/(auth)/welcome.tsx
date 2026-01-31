import { Button, Host, HStack, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { frame, padding } from "@expo/ui/swift-ui/modifiers";
import * as AppleAuthentication from "expo-apple-authentication";
import { router } from "expo-router";
import React from "react";
import { Alert, Platform, useColorScheme } from "react-native";
import AppleLogo from "@/components/AppleLogo";
import GoogleLogo from "@/components/GoogleLogo";
import Logo from "@/components/Logo";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function OnboardingScreen() {
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);
  const [isAppleLoading, setIsAppleLoading] = React.useState(false);
  const [isAppleAvailable, setIsAppleAvailable] = React.useState(false);
  const colorScheme = useColorScheme();
  const appleIconColor = colorScheme === "dark" ? "#FFFFFF" : "#000000";

  React.useEffect(() => {
    // Check if Apple Authentication is available (iOS only)
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(setIsAppleAvailable);
    }
  }, []);

  const onGoogleSignInPress = async () => {
    if (isGoogleLoading) {
      return;
    }
    setIsGoogleLoading(true);

    try {
      const response = await authClient.signIn.social({
        provider: "google",
        callbackURL: "teak://",
      });
      if (response.error) {
        Alert.alert(
          "Google Sign In Failed",
          getAuthErrorMessage(
            response.error,
            "Failed to sign in with Google. Please try again."
          )
        );
      } else {
        router.replace("/(tabs)/(home)");
      }
    } catch (error) {
      console.error(
        "Google sign in error:",
        error instanceof Error ? error.message : error
      );
      Alert.alert(
        "Google Sign In Failed",
        getAuthErrorMessage(
          error,
          "Failed to sign in with Google. Please try again."
        )
      );
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const onAppleSignInPress = async () => {
    if (isAppleLoading) {
      return;
    }
    setIsAppleLoading(true);

    try {
      // Use native Apple Authentication
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error("No identity token received from Apple");
      }

      // Use the ID token flow with Better Auth
      const response = await authClient.signIn.social({
        provider: "apple",
        idToken: {
          token: credential.identityToken,
        },
      });

      if (response.error) {
        Alert.alert(
          "Apple Sign In Failed",
          getAuthErrorMessage(
            response.error,
            "Failed to sign in with Apple. Please try again."
          )
        );
      } else {
        router.replace("/(tabs)/(home)");
      }
    } catch (error: unknown) {
      // Don't show error if user cancelled
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ERR_REQUEST_CANCELED"
      ) {
        return;
      }
      console.error(
        "Apple sign in error:",
        error instanceof Error ? error.message : error
      );
      Alert.alert(
        "Apple Sign In Failed",
        getAuthErrorMessage(
          error,
          "Failed to sign in with Apple. Please try again."
        )
      );
    } finally {
      setIsAppleLoading(false);
    }
  };

  return (
    <Host
      style={{
        flex: 1,
      }}
    >
      <VStack
        modifiers={[
          padding({ leading: 28, trailing: 28, top: 32, bottom: 12 }),
        ]}
      >
        <VStack alignment="leading" spacing={12}>
          <HStack modifiers={[frame({ width: 65, height: 37 })]}>
            <Logo height={24} variant="primary" width={100} />
          </HStack>
          <Text design="rounded" lineLimit={2} size={20} weight="bold">
            Save Anything. Anywhere.
          </Text>
          <Text color="secondary" design="rounded" lineLimit={4} size={16}>
            Your personal everything management system. Organize, save, and
            access all your text, images, and documents in one place.
          </Text>
        </VStack>

        <Spacer />

        <VStack spacing={30}>
          <VStack spacing={12}>
            {isAppleAvailable && (
              <Button
                controlSize="large"
                disabled={isGoogleLoading || isAppleLoading}
                onPress={onAppleSignInPress}
                variant="bordered"
              >
                <HStack alignment="center" spacing={10}>
                  <Spacer />
                  <HStack modifiers={[frame({ width: 20, height: 20 })]}>
                    <AppleLogo color={appleIconColor} />
                  </HStack>
                  <Text color="primary" design="rounded" weight="medium">
                    {isAppleLoading ? "Signing in..." : "Continue with Apple"}
                  </Text>
                  <Spacer />
                </HStack>
              </Button>
            )}

            <Button
              controlSize="large"
              disabled={isGoogleLoading || isAppleLoading}
              onPress={onGoogleSignInPress}
              variant="bordered"
            >
              <HStack alignment="center" spacing={10}>
                <Spacer />
                <HStack modifiers={[frame({ width: 18, height: 18 })]}>
                  <GoogleLogo />
                </HStack>
                <Text color="primary" design="rounded" weight="medium">
                  {isGoogleLoading ? "Signing in..." : "Continue with Google"}
                </Text>
                <Spacer />
              </HStack>
            </Button>

            <Button
              controlSize="large"
              disabled={isGoogleLoading || isAppleLoading}
              onPress={() => router.push("/(auth)/sign-up")}
              variant="bordered"
            >
              <HStack alignment="center" spacing={10}>
                <Spacer />
                <Text color="primary" design="rounded" weight="medium">
                  Register with Email
                </Text>
                <Spacer />
              </HStack>
            </Button>
          </VStack>
          <Button
            controlSize="large"
            disabled={isGoogleLoading || isAppleLoading}
            onPress={() => router.push("/(auth)/sign-in")}
            variant="bordered"
          >
            <HStack alignment="center" spacing={10}>
              <Spacer />
              <Text color="primary" design="rounded" weight="medium">
                Login with Email
              </Text>
              <Spacer />
            </HStack>
          </Button>
        </VStack>
      </VStack>
    </Host>
  );
}
