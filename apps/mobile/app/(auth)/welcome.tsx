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
import { SIGNUPS_PAUSED_MESSAGE } from "@teak/convex/shared/constants";
import { router } from "expo-router";
import React from "react";
import { Alert, PlatformColor, useColorScheme } from "react-native";
import AppleLogo from "@/components/AppleLogo";
import GoogleLogo from "@/components/GoogleLogo";
import Logo from "@/components/Logo";
import { useMobileAuth } from "@/lib/mobile-auth-context";

// Email options open AuthKit's hosted page directly, on its sign-in or
// sign-up screen.
const SIGN_IN_LABELS = {
  AppleOAuth: "Apple",
  GoogleOAuth: "Google",
  "sign-in": "Email",
  "sign-up": "Email",
};
type SignInOption = keyof typeof SIGN_IN_LABELS;

export default function OnboardingScreen() {
  const mobileAuth = useMobileAuth();
  const authMode = mobileAuth.mode;
  const [pending, setPending] = React.useState<SignInOption | null>(null);
  const colorScheme = useColorScheme();
  const appleIconColor = colorScheme === "dark" ? "#FFFFFF" : "#000000";

  const signIn = async (option: SignInOption) => {
    if (pending) {
      return;
    }
    setPending(option);
    const label = SIGN_IN_LABELS[option];
    try {
      const signedIn =
        option === "sign-in" || option === "sign-up"
          ? await mobileAuth.signIn("authkit", option)
          : await mobileAuth.signIn(option);
      if (signedIn) {
        router.replace("/(tabs)/(home)");
      }
    } catch (error) {
      console.error(
        `${label} sign in error:`,
        error instanceof Error ? error.message : error
      );
      Alert.alert(
        `${label} Sign In Failed`,
        error instanceof Error && error.message
          ? error.message
          : `Failed to sign in with ${label}. Please try again.`
      );
    } finally {
      setPending(null);
    }
  };
  const buttonLabel = (option: SignInOption, idle: string) =>
    pending === option ? "Signing in..." : idle;

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
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
        {authMode?.signupsDisabled && (
          <Text
            modifiers={[font({ design: "rounded" }), padding({ bottom: 16 })]}
          >
            {SIGNUPS_PAUSED_MESSAGE}
          </Text>
        )}

        <VStack spacing={30}>
          <VStack spacing={12}>
            <Button
              modifiers={[
                buttonStyle("bordered"),
                controlSize("large"),
                disabled(pending !== null),
                tint(PlatformColor("label")),
              ]}
              onPress={() => void signIn("AppleOAuth")}
            >
              <HStack alignment="center" spacing={10}>
                <Spacer />
                <HStack modifiers={[frame({ width: 20, height: 20 })]}>
                  <AppleLogo color={appleIconColor} />
                </HStack>
                <Text
                  modifiers={[font({ design: "rounded", weight: "medium" })]}
                >
                  {buttonLabel("AppleOAuth", "Continue with Apple")}
                </Text>
                <Spacer />
              </HStack>
            </Button>

            <Button
              modifiers={[
                buttonStyle("bordered"),
                controlSize("large"),
                disabled(pending !== null),
                tint(PlatformColor("label")),
              ]}
              onPress={() => void signIn("GoogleOAuth")}
            >
              <HStack alignment="center" spacing={10}>
                <Spacer />
                <HStack modifiers={[frame({ width: 18, height: 18 })]}>
                  <GoogleLogo />
                </HStack>
                <Text
                  modifiers={[font({ design: "rounded", weight: "medium" })]}
                >
                  {buttonLabel("GoogleOAuth", "Continue with Google")}
                </Text>
                <Spacer />
              </HStack>
            </Button>

            {authMode?.signupsDisabled === false && (
              <Button
                modifiers={[
                  buttonStyle("bordered"),
                  controlSize("large"),
                  disabled(pending !== null),
                  tint(PlatformColor("label")),
                ]}
                onPress={() => void signIn("sign-up")}
              >
                <HStack alignment="center" spacing={10}>
                  <Spacer />
                  <Text
                    modifiers={[font({ design: "rounded", weight: "medium" })]}
                  >
                    {buttonLabel("sign-up", "Register with Email")}
                  </Text>
                  <Spacer />
                </HStack>
              </Button>
            )}
          </VStack>
          <Button
            modifiers={[
              buttonStyle("bordered"),
              controlSize("large"),
              disabled(pending !== null),
              tint(PlatformColor("label")),
            ]}
            onPress={() => void signIn("sign-in")}
          >
            <HStack alignment="center" spacing={10}>
              <Spacer />
              <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
                {buttonLabel("sign-in", "Login with Email")}
              </Text>
              <Spacer />
            </HStack>
          </Button>
        </VStack>
      </VStack>
    </Host>
  );
}
