import * as React from "react";
import { Alert, Keyboard } from "react-native";
import {
  Button,
  Form,
  Host,
  HStack,
  LabeledContent,
  Section,
  SecureField,
  Spacer,
  TextField,
  Text,
} from "@expo/ui/swift-ui";
import { useFocusEffect } from "expo-router";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function SignUpScreen() {
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      return () => {
        Keyboard.dismiss();
      };
    }, [])
  );

  const waitForKeyboardToSettle = React.useCallback(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 30));
      }),
    []
  );

  // Handle submission of sign-up form
  const onSignUpPress = async () => {
    if (isSubmitting) return;

    Keyboard.dismiss();
    await waitForKeyboardToSettle();

    if (!emailAddress.trim() || !password.trim()) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }

    if (password.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters long.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await authClient.signUp.email({
        email: emailAddress.trim(),
        password,
        name: "",
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
      console.error(error);
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
    <Host matchContents useViewportSizeMeasurement style={{ flex: 1 }}>
      <Form scrollEnabled={false}>
        <Section>
          <LabeledContent label="Email">
            <TextField
              placeholder="Enter your email"
              keyboardType="email-address"
              autocorrection={false}
              onChangeText={setEmailAddress}
            />
          </LabeledContent>

          <LabeledContent label="Password">
            <SecureField
              placeholder="Enter your password (min. 8 characters)"
              onChangeText={setPassword}
            />
          </LabeledContent>

          <Button
            variant="bordered"
            controlSize="large"
            onPress={onSignUpPress}
            disabled={isSubmitting}
          >
            <HStack spacing={10} alignment="center">
              <Spacer />
              <Text color="primary" weight="medium" design="rounded">
                {isSubmitting ? "Creating..." : "Create Account"}
              </Text>
              <Spacer />
            </HStack>
          </Button>
        </Section>
      </Form>
    </Host>
  );
}
