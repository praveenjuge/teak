import { Button, Host, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled,
  font,
} from "@expo/ui/swift-ui/modifiers";
import { SIGNUPS_PAUSED_MESSAGE } from "@teak/convex/shared/constants";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { useMobileAuth } from "@/lib/mobile-auth-context";

function ContinueButton({
  busy,
  onPress,
}: {
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      modifiers={[
        buttonStyle("borderedProminent"),
        controlSize("large"),
        disabled(busy),
      ]}
      onPress={onPress}
    >
      <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
        {busy ? "Signing in..." : "Continue with email"}
      </Text>
    </Button>
  );
}
export default function HostedAuthScreen({
  register = false,
}: {
  register?: boolean;
}) {
  const auth = useMobileAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const paused = register && auth.mode.signupsDisabled;
  const signIn = async () => {
    if (busy || paused) {
      return;
    }
    setBusy(true);
    try {
      if (await auth.signIn("authkit", register ? "sign-up" : "sign-in")) {
        router.replace("/(tabs)/(home)");
      }
    } catch {
      Alert.alert("Sign In Failed", "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Stack.Screen
        options={{ title: register ? "Create account" : "Sign in" }}
      />
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <VStack alignment="center" spacing={16}>
          <Spacer />
          <Text modifiers={[font({ design: "rounded" })]}>
            {paused
              ? SIGNUPS_PAUSED_MESSAGE
              : "Continue in your browser to sign in securely."}
          </Text>
          {!paused && (
            <ContinueButton busy={busy} onPress={() => void signIn()} />
          )}
          <Spacer />
        </VStack>
      </Host>
    </>
  );
}
