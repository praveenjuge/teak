import React from "react";
import { Alert } from "react-native";
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
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function SignInScreen() {
  const [isLoading, setIsLoading] = React.useState(false);
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");

  // Handle the submission of the sign-in form
  const onSignInPress = async () => {
    if (isLoading) return;

    if (!emailAddress.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter both email and password.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await authClient.signIn.email({
        email: emailAddress.trim(),
        password,
      });
      if (response.error) {
        Alert.alert(
          "Sign In Failed",
          getAuthErrorMessage(
            response.error,
            "Invalid email or password. Please try again."
          )
        );
        return;
      }
    } catch (error) {
      console.error(error);
      Alert.alert(
        "Sign In Failed",
        getAuthErrorMessage(
          error,
          "Invalid email or password. Please try again."
        )
      );
    } finally {
      setIsLoading(false);
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
              placeholder="Enter your password"
              onChangeText={setPassword}
            />
          </LabeledContent>
          <Button
            variant="bordered"
            controlSize="large"
            onPress={onSignInPress}
            disabled={isLoading || !emailAddress.trim() || !password.trim()}
          >
            <HStack spacing={10} alignment="center">
              <Spacer />
              <Text color="primary" weight="medium" design="rounded">
                {isLoading ? "Signing in..." : "Sign In"}
              </Text>
              <Spacer />
            </HStack>
          </Button>
        </Section>
      </Form>
    </Host>
  );
}
