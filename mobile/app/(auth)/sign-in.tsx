import { useRouter } from "expo-router";
import React from "react";
import { Alert, Keyboard } from "react-native";
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

  const dismissKeyboard = React.useCallback(
    () =>
      new Promise<void>((resolve) => {
        let resolved = false;
        const subscription = Keyboard.addListener("keyboardDidHide", () => {
          if (resolved) return;
          resolved = true;
          subscription.remove();
          resolve();
        });

        Keyboard.dismiss();

        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          subscription.remove();
          resolve();
        }, 250);
      }),
    []
  );

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
      await dismissKeyboard();
      router.replace("/(tabs)");
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
      <VStack
        spacing={16}
        alignment="leading"
        modifiers={[
          padding({ leading: 20, trailing: 20, top: 24, bottom: 24 }),
        ]}
      >
        <VStack spacing={6} alignment="leading">
          <Text weight="medium" design="rounded">
            Email
          </Text>
          <TextField
            placeholder="Enter your email"
            keyboardType="email-address"
            autocorrection={false}
            onChangeText={setEmailAddress}
          />
        </VStack>

        <VStack spacing={6} alignment="leading">
          <Text weight="medium" design="rounded">
            Password
          </Text>
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
