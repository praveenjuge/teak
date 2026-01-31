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
import { useRouter } from "expo-router";
import React from "react";
import { Alert } from "react-native";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function SignInScreen() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");

  const onSignInPress = async () => {
    if (isLoading) {
      return;
    }

    if (!(emailAddress.trim() && password.trim())) {
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
      router.replace("/(tabs)/(home)");
    } catch (error) {
      console.error(
        "Sign in error:",
        error instanceof Error ? error.message : error
      );
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
    <Host matchContents>
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
            placeholder="Enter your password"
          />
        </LabeledContent>

        <Button
          controlSize="large"
          disabled={isLoading || !emailAddress.trim() || !password.trim()}
          onPress={onSignInPress}
          variant="bordered"
        >
          <HStack alignment="center" spacing={10}>
            <Spacer />
            <Text color="primary" design="rounded" weight="medium">
              {isLoading ? "Signing in..." : "Sign In"}
            </Text>
            <Spacer />
          </HStack>
        </Button>
      </VStack>
    </Host>
  );
}
