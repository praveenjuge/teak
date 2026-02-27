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
import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Keyboard, PlatformColor, Pressable } from "react-native";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function SignUpScreen() {
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canSubmit =
    !isSubmitting &&
    emailAddress.trim().length > 0 &&
    password.trim().length > 0;

  useFocusEffect(
    useCallback(() => {
      return () => {
        Keyboard.dismiss();
      };
    }, [])
  );

  const waitForKeyboardToSettle = useCallback(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 30));
      }),
    []
  );

  const onSignUpPress = async () => {
    if (isSubmitting) {
      return;
    }

    Keyboard.dismiss();
    await waitForKeyboardToSettle();

    if (!(emailAddress.trim() && password.trim())) {
      const message = "Please fill in all fields.";
      setErrorMessage(message);
      Alert.alert("Error", message);
      return;
    }

    if (password.length < 8) {
      const message = "Password must be at least 8 characters long.";
      setErrorMessage(message);
      Alert.alert("Error", message);
      return;
    }

    const derivedName = emailAddress.trim().split("@")[0]?.trim() || "User";

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await authClient.signUp.email({
        email: emailAddress.trim(),
        password,
        name: derivedName,
      });

      if (response.error) {
        const message = getAuthErrorMessage(
          response.error,
          "Failed to create account. Please try again."
        );
        setErrorMessage(message);
        Alert.alert("Sign Up Failed", message);
        return;
      }

      Alert.alert(
        "Verify your email",
        "We just sent you a verification link. Please check your inbox to activate your account."
      );
    } catch (error) {
      const message = getAuthErrorMessage(
        error,
        "Failed to create account. Please try again."
      );
      setErrorMessage(message);
      Alert.alert("Sign Up Failed", message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityHint="Creates your account with the entered credentials."
              accessibilityLabel={
                isSubmitting ? "Creating account" : "Create account"
              }
              accessibilityRole="button"
              disabled={!canSubmit}
              hitSlop={8}
              onPress={() => void onSignUpPress()}
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
                name={isSubmitting ? "hourglass" : "checkmark"}
                weight={isSubmitting ? "regular" : "semibold"}
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
              keyboardType="email-address"
              onChangeText={setEmailAddress}
              placeholder="Enter your email"
            />
          </LabeledContent>

          <LabeledContent label="Password">
            <SecureField
              onChangeText={setPassword}
              placeholder="Enter your password (min. 8 characters)"
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
