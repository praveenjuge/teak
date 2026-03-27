import { useSSO } from "@clerk/expo";
import { Button, Host, HStack, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import * as AuthSession from "expo-auth-session";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import { Alert, Platform, PlatformColor, useColorScheme } from "react-native";
import AppleLogo from "@/components/AppleLogo";
import GoogleLogo from "@/components/GoogleLogo";
import Logo from "@/components/Logo";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

void WebBrowser.maybeCompleteAuthSession();

export default function OnboardingScreen() {
  const { startSSOFlow } = useSSO();
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);
  const [isAppleLoading, setIsAppleLoading] = React.useState(false);
  const isAppleAvailable = Platform.OS === "ios";
  const colorScheme = useColorScheme();
  const appleIconColor = colorScheme === "dark" ? "#FFFFFF" : "#000000";
  const redirectUrl = AuthSession.makeRedirectUri({ scheme: "teak" });

  const onGoogleSignInPress = async () => {
    if (isGoogleLoading) {
      return;
    }
    setIsGoogleLoading(true);

    try {
      const result = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl,
      });

      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
        router.replace("/(tabs)/(home)");
        return;
      }

      throw new Error("Google sign in could not be completed.");
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
      const result = await startSSOFlow({
        strategy: "oauth_apple",
        redirectUrl,
      });

      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
        router.replace("/(tabs)/(home)");
        return;
      }

      throw new Error("Apple sign in could not be completed.");
    } catch (error: unknown) {
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
    <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack
        modifiers={[
          padding({ leading: 28, trailing: 28, top: 32, bottom: 12 }),
        ]}
      >
        <VStack alignment="leading" spacing={12}>
          <HStack modifiers={[frame({ width: 65, height: 37 })]}>
            <Logo height={24} variant="primary" width={100} />
          </HStack>
          <Text
            modifiers={[
              font({ design: "rounded", size: 20, weight: "bold" }),
              lineLimit(2),
            ]}
          >
            Save Anything. Anywhere.
          </Text>
          <Text
            modifiers={[
              foregroundStyle({ type: "hierarchical", style: "secondary" }),
              font({ design: "rounded", size: 16 }),
              lineLimit(5),
            ]}
          >
            Your personal everything management system. Organize, save, and
            access all your text, images, and documents in one place.
          </Text>
        </VStack>

        <Spacer />

        <VStack spacing={30}>
          <VStack spacing={12}>
            {isAppleAvailable && (
              <Button
                modifiers={[
                  buttonStyle("bordered"),
                  controlSize("large"),
                  disabled(isGoogleLoading || isAppleLoading),
                  tint(PlatformColor("label")),
                ]}
                onPress={onAppleSignInPress}
              >
                <HStack alignment="center" spacing={10}>
                  <Spacer />
                  <HStack modifiers={[frame({ width: 20, height: 20 })]}>
                    <AppleLogo color={appleIconColor} />
                  </HStack>
                  <Text
                    modifiers={[font({ design: "rounded", weight: "medium" })]}
                  >
                    {isAppleLoading ? "Signing in..." : "Continue with Apple"}
                  </Text>
                  <Spacer />
                </HStack>
              </Button>
            )}

            <Button
              modifiers={[
                buttonStyle("bordered"),
                controlSize("large"),
                disabled(isGoogleLoading || isAppleLoading),
                tint(PlatformColor("label")),
              ]}
              onPress={onGoogleSignInPress}
            >
              <HStack alignment="center" spacing={10}>
                <Spacer />
                <HStack modifiers={[frame({ width: 18, height: 18 })]}>
                  <GoogleLogo />
                </HStack>
                <Text
                  modifiers={[font({ design: "rounded", weight: "medium" })]}
                >
                  {isGoogleLoading ? "Signing in..." : "Continue with Google"}
                </Text>
                <Spacer />
              </HStack>
            </Button>

            <Button
              modifiers={[
                buttonStyle("bordered"),
                controlSize("large"),
                disabled(isGoogleLoading || isAppleLoading),
                tint(PlatformColor("label")),
              ]}
              onPress={() => router.push("/(auth)/sign-up")}
            >
              <HStack alignment="center" spacing={10}>
                <Spacer />
                <Text
                  modifiers={[font({ design: "rounded", weight: "medium" })]}
                >
                  Register with Email
                </Text>
                <Spacer />
              </HStack>
            </Button>
          </VStack>
          <Button
            modifiers={[
              buttonStyle("bordered"),
              controlSize("large"),
              disabled(isGoogleLoading || isAppleLoading),
              tint(PlatformColor("label")),
            ]}
            onPress={() => router.push("/(auth)/sign-in")}
          >
            <HStack alignment="center" spacing={10}>
              <Spacer />
              <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
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
