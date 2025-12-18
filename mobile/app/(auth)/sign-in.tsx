import { useRouter } from "expo-router";
import React from "react";
import { Alert } from "react-native";
import {
  Button,
  Host,
  HStack,
  SecureField,
  Spacer,
  TextField,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import { padding } from "@expo/ui/swift-ui/modifiers";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function SignInScreen() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");

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
      router.replace("/(tabs)/(home)");
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
    <Host matchContents>
      <VStack
        spacing={24}
        alignment="leading"
        modifiers={[padding({ all: 24 })]}
      >
        <VStack spacing={6} alignment="leading">
          <Text design="rounded">Email</Text>
          <TextField
            placeholder="Enter your email"
            keyboardType="email-address"
            autocorrection={false}
            onChangeText={setEmailAddress}
          />
        </VStack>

        <VStack spacing={6} alignment="leading">
          <Text design="rounded">Password</Text>
          <SecureField
            placeholder="Enter your password"
            onChangeText={setPassword}
          />
        </VStack>

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
      </VStack>
    </Host>
  );
}
