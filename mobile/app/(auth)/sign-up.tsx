import * as React from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
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

export default function SignUpScreen() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");

  // Handle submission of sign-up form
  const onSignUpPress = async () => {
    if (isLoading) return;

    if (!emailAddress.trim() || !password.trim()) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }

    if (password.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters long.");
      return;
    }

    setIsLoading(true);

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
      Alert.alert(
        "Verify your email",
        "We just sent you a verification link. Please check your inbox to activate your account."
      );
      router.replace("/(tabs)/(home)");
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
      setIsLoading(false);
    }
  };

  return (
    <Host matchContents useViewportSizeMeasurement>
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
            variant="borderedProminent"
            controlSize="large"
            onPress={onSignUpPress}
            disabled={isLoading || !emailAddress.trim() || password.length < 8}
          >
            <HStack spacing={10} alignment="center">
              <Spacer />
              <Text color="primary" weight="medium" design="rounded">
                {isLoading ? "Creating Account..." : "Create Account"}
              </Text>
              <Spacer />
            </HStack>
          </Button>
        </Section>
      </Form>
    </Host>
  );
}
