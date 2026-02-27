import {
  Button,
  Host,
  HStack,
  LabeledContent,
  List,
  SecureField,
  Spacer,
  Text,
  TextField,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  listStyle,
  scrollDisabled,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Keyboard } from "react-native";
import { colors } from "@/constants/colors";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function SignUpScreen() {
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

        <Button
          modifiers={[
            buttonStyle("borderedProminent"),
            controlSize("large"),
            tint(colors.primary),
            disabled(isSubmitting),
          ]}
          onPress={onSignUpPress}
        >
          <HStack>
            <Spacer />
            <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
              {isSubmitting ? "Creating..." : "Create Account"}
            </Text>
            <Spacer />
          </HStack>
        </Button>
      </List>
    </Host>
  );
}
