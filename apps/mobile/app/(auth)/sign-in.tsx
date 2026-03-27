import { useSignIn } from "@clerk/expo/legacy";
import {
  Host,
  LabeledContent,
  List,
  SecureField,
  Text,
  TextField,
} from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  listStyle,
  scrollDisabled,
} from "@expo/ui/swift-ui/modifiers";
import { Stack, useRouter } from "expo-router";
import { usePostHog } from "posthog-react-native";
import React from "react";
import { Alert, PlatformColor, Pressable } from "react-native";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function SignInScreen() {
  const router = useRouter();
  const posthog = usePostHog();
  const { signIn, isLoaded, setActive } = useSignIn();
  const [isLoading, setIsLoading] = React.useState(false);
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const canSubmit =
    !isLoading && emailAddress.trim().length > 0 && password.trim().length > 0;

  const onSignInPress = async () => {
    if (isLoading) {
      return;
    }

    if (!(emailAddress.trim() && password.trim())) {
      const message = "Please enter both email and password.";
      setErrorMessage(message);
      Alert.alert("Error", message);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (!(isLoaded && signIn)) {
        throw new Error("Authentication is still loading.");
      }

      const result = await signIn.create({
        identifier: emailAddress.trim(),
        password,
      });

      if (result.status !== "complete" || !result.createdSessionId) {
        throw new Error("Sign in could not be completed.");
      }

      await setActive({ session: result.createdSessionId });

      posthog.identify(emailAddress.trim(), {
        $set: { email: emailAddress.trim() },
        $set_once: { first_sign_in_date: new Date().toISOString() },
      });
      posthog.capture("user_signed_in", { method: "email" });
      router.replace("/(tabs)/(home)");
    } catch (error) {
      const message = getAuthErrorMessage(
        error,
        "Invalid email or password. Please try again."
      );
      setErrorMessage(message);
      Alert.alert("Sign In Failed", message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityHint="Signs in with your email and password."
              accessibilityLabel={isLoading ? "Signing in" : "Sign in"}
              accessibilityRole="button"
              disabled={!canSubmit}
              hitSlop={8}
              onPress={() => void onSignInPress()}
            >
              <IconSymbol
                animationSpec={
                  canSubmit
                    ? {
                        effect: {
                          type: "bounce",
                          direction: "up",
                        },
                      }
                    : undefined
                }
                color={PlatformColor(canSubmit ? "label" : "tertiaryLabel")}
                name={isLoading ? "hourglass" : "checkmark"}
                weight={isLoading ? "regular" : "semibold"}
              />
            </Pressable>
          ),
        }}
      />
      <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
        <List modifiers={[listStyle("plain"), scrollDisabled()]}>
          <LabeledContent label="Email">
            <TextField
              autocorrection={false}
              defaultValue={emailAddress}
              keyboardType="email-address"
              onChangeText={setEmailAddress}
              placeholder="Enter your email"
            />
          </LabeledContent>

          <LabeledContent label="Password">
            <SecureField
              defaultValue={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
            />
          </LabeledContent>

          {errorMessage ? (
            <Text
              modifiers={[foregroundStyle("red"), font({ design: "rounded" })]}
            >
              {errorMessage}
            </Text>
          ) : null}
        </List>
      </Host>
    </>
  );
}
