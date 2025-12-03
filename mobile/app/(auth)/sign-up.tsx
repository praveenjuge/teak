import * as React from "react";
import {
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { colors, borderWidths } from "../../constants/colors";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";
import GoogleLogo from "@/components/GoogleLogo";

export default function SignUpScreen() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);

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
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.keyboardAvoidingView}
    >
      <View style={styles.content}>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Email</Text>
          <TextInput
            style={styles.textInput}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            value={emailAddress}
            placeholder="Enter your email"
            placeholderTextColor={colors.secondaryLabel}
            onChangeText={setEmailAddress}
            editable={!isLoading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Password</Text>
          <TextInput
            style={styles.textInput}
            value={password}
            placeholder="Enter your password (min. 8 characters)"
            placeholderTextColor={colors.secondaryLabel}
            secureTextEntry={true}
            autoComplete="new-password"
            onChangeText={setPassword}
            editable={!isLoading}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            (isLoading ||
              isGoogleLoading ||
              !emailAddress.trim() ||
              !password.trim()) &&
              styles.disabledButton,
          ]}
          onPress={onSignUpPress}
          disabled={
            isLoading ||
            isGoogleLoading ||
            !emailAddress.trim() ||
            !password.trim()
          }
        >
          <Text style={[styles.primaryButtonText]}>
            {isLoading ? "Creating Account..." : "Create Account"}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoidingView: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    gap: 24,
    marginBottom: 32,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontWeight: "500",
    color: colors.label,
  },
  textInput: {
    backgroundColor: colors.adaptiveWhite,
    borderColor: colors.border,
    borderWidth: borderWidths.hairline,
    borderRadius: 12,
    paddingHorizontal: 16,
    color: colors.label,
    minHeight: 48,
    overflow: "hidden",
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    marginTop: 8,
  },
  disabledButton: {
    opacity: 0.4,
  },
  primaryButtonText: {
    color: "white",
    fontWeight: "600",
  },
});
