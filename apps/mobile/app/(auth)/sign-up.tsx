import { useSignUp } from "@clerk/expo/legacy";
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
import { usePostHog } from "posthog-react-native";
import { useCallback, useState } from "react";
import { Alert, Keyboard, PlatformColor, Pressable } from "react-native";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function SignUpScreen() {
  const posthog = usePostHog();
  const { signUp, isLoaded, setActive } = useSignUp();
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPendingVerification, setIsPendingVerification] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canSubmit =
    !isSubmitting &&
    (isPendingVerification
      ? verificationCode.trim().length > 0
      : emailAddress.trim().length > 0 && password.trim().length > 0);

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

    const hasEmailAndPassword =
      emailAddress.trim().length > 0 && password.trim().length > 0;

    if (isPendingVerification) {
      setIsSubmitting(true);
      setErrorMessage(null);

      try {
        if (!(isLoaded && signUp)) {
          throw new Error("Authentication is still loading.");
        }

        const result = await signUp.attemptEmailAddressVerification({
          code: verificationCode.trim(),
        });

        if (result.status !== "complete" || !result.createdSessionId) {
          throw new Error("Verification could not be completed.");
        }

        await setActive({ session: result.createdSessionId });
        posthog.identify(emailAddress.trim(), {
          $set: { email: emailAddress.trim() },
          $set_once: { sign_up_date: new Date().toISOString() },
        });
        posthog.capture("user_signed_up", { method: "email" });
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

      return;
    }

    if (!hasEmailAndPassword) {
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

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (!(isLoaded && signUp)) {
        throw new Error("Authentication is still loading.");
      }

      await signUp.create({
        emailAddress: emailAddress.trim(),
        password,
      });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setIsPendingVerification(true);
      Alert.alert(
        "Verify your email",
        "We just sent you a verification code. Enter it here to activate your account."
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
                isSubmitting
                  ? "Creating account"
                  : isPendingVerification
                    ? "Verify email"
                    : "Create account"
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
          {isPendingVerification ? (
            <LabeledContent label="Code">
              <TextField
                defaultValue={verificationCode}
                keyboardType="numeric"
                onChangeText={setVerificationCode}
                placeholder="Enter the email code"
              />
            </LabeledContent>
          ) : (
            <>
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
                  placeholder="Enter your password (min. 8 characters)"
                />
              </LabeledContent>
            </>
          )}

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
