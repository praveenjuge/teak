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
import { useRouter } from "expo-router";
import React from "react";
import { Alert } from "react-native";
import { colors } from "@/constants/colors";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function SignInScreen() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

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
      const response = await authClient.signIn.email({
        email: emailAddress.trim(),
        password,
      });
      if (response.error) {
        const message = getAuthErrorMessage(
          response.error,
          "Invalid email or password. Please try again."
        );
        setErrorMessage(message);
        Alert.alert("Sign In Failed", message);
        return;
      }

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

        <Button
          modifiers={[
            buttonStyle("borderedProminent"),
            controlSize("large"),
            tint(colors.primary),
            disabled(isLoading || !emailAddress.trim() || !password.trim()),
          ]}
          onPress={onSignInPress}
        >
          <HStack>
            <Spacer />
            <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Text>
            <Spacer />
          </HStack>
        </Button>
      </List>
    </Host>
  );
}
