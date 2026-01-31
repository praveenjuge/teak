import {
  Button,
  Host,
  HStack,
  LabeledContent,
  SecureField,
  Spacer,
  Text,
  TextField,
  VStack,
} from "@expo/ui/swift-ui";
import { padding } from "@expo/ui/swift-ui/modifiers";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Keyboard } from "react-native";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function SignUpScreen() {
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Handle submission of sign-up form
  const onSignUpPress = async () => {
    if (isSubmitting) {
      return;
    }

    Keyboard.dismiss();
    await waitForKeyboardToSettle();

    if (!(emailAddress.trim() && password.trim())) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }

    if (password.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters long.");
      return;
    }

    const derivedName = emailAddress.trim().split("@")[0]?.trim() || "User";

    setIsSubmitting(true);

    try {
      const response = await authClient.signUp.email({
        email: emailAddress.trim(),
        password,
        name: derivedName,
      });
      if (response.error) {
        Alert.alert(
          "Sign Up Failed",
          getAuthErrorMessage(
            response.error,
            "Failed to create account. Please try again."
          )
        );
        return;
      }
      if (response) {
        Alert.alert(
          "Verify your email",
          "We just sent you a verification link. Please check your inbox to activate your account."
        );
      }
    } catch (error) {
      console.error(
        "Sign up error:",
        error instanceof Error ? error.message : error
      );
      Alert.alert(
        "Sign Up Failed",
        getAuthErrorMessage(
          error,
          "Failed to create account. Please try again."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Host matchContents useViewportSizeMeasurement>
      <VStack modifiers={[padding({ all: 24 })]} spacing={24}>
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

        <Button
          controlSize="large"
          disabled={isSubmitting}
          onPress={onSignUpPress}
          variant="bordered"
        >
          <HStack alignment="center" spacing={10}>
            <Spacer />
            <Text color="primary" design="rounded" weight="medium">
              {isSubmitting ? "Creating..." : "Create Account"}
            </Text>
            <Spacer />
          </HStack>
        </Button>
      </VStack>
    </Host>
  );
}
