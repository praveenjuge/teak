import React from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import Logo from "../../components/Logo";
import GoogleLogo from "@/components/GoogleLogo";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";
import { Button, HStack, Host, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { frame, padding } from "@expo/ui/swift-ui/modifiers";

export default function OnboardingScreen() {
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);

  const onGoogleSignInPress = async () => {
    if (isGoogleLoading) return;
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
      }
    } catch (error) {
      console.error(error);
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

  return (
    <Host matchContents useViewportSizeMeasurement style={{ flex: 1 }}>
      <VStack
        modifiers={[
          padding({ leading: 28, trailing: 28, top: 32, bottom: 12 }),
        ]}
      >
        <VStack spacing={12} alignment="leading">
          <HStack modifiers={[frame({ width: 65, height: 37 })]}>
            <Logo height={24} width={100} variant="primary" />
          </HStack>
          <Text weight="bold" size={20} lineLimit={2} design="rounded">
            Save Anything. Anywhere.
          </Text>
          <Text size={16} lineLimit={4} color="secondary" design="rounded">
            Your personal everything management system. Organize, save, and
            access all your text, images, and documents in one place.
          </Text>
        </VStack>

        <Spacer />

        <VStack spacing={30}>
          <VStack spacing={12}>
            <Button
              variant="bordered"
              controlSize="large"
              onPress={onGoogleSignInPress}
              disabled={isGoogleLoading}
            >
              <HStack spacing={10} alignment="center">
                <Spacer />
                <HStack modifiers={[frame({ width: 20, height: 20 })]}>
                  <GoogleLogo />
                </HStack>
                <Text color="primary" weight="medium" design="rounded">
                  {isGoogleLoading ? "Signing in..." : "Continue with Google"}
                </Text>
                <Spacer />
              </HStack>
            </Button>
            <Button
              variant="bordered"
              controlSize="large"
              onPress={() => router.push("/sign-up")}
            >
              <HStack spacing={10} alignment="center">
                <Spacer />
                <Text color="primary" weight="medium" design="rounded">
                  Register with Email
                </Text>
                <Spacer />
              </HStack>
            </Button>
          </VStack>
          <Button
            variant="bordered"
            controlSize="large"
            onPress={() => router.push("/sign-in")}
          >
            <HStack spacing={10} alignment="center">
              <Spacer />
              <Text color="primary" weight="medium" design="rounded">
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
