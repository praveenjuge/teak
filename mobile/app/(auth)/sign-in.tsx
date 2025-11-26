import { useRouter } from "expo-router";
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
import React from "react";
import { colors, borderWidths } from "../../constants/colors";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";
import GoogleLogo from "@/components/GoogleLogo";

export default function SignInScreen() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);

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

  // Handle Google sign-in
  const onGoogleSignInPress = async () => {
    if (isGoogleLoading) return;
    setIsGoogleLoading(true);

    try {
      const response = await authClient.signIn.social({
        provider: "google",
      });
      if (response.error) {
        Alert.alert(
          "Google Sign In Failed",
          getAuthErrorMessage(
            response.error,
            "Failed to sign in with Google. Please try again."
          )
        );
      }
    } catch (error) {
      console.error(error);
      Alert.alert(
        "Google Sign In Failed",
        getAuthErrorMessage(
          error,
          "Failed to sign in with Google. Please try again."
        )
      );
    } finally {
      setIsGoogleLoading(false);
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
            placeholder="Enter your password"
            placeholderTextColor={colors.secondaryLabel}
            secureTextEntry={true}
            autoComplete="current-password"
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
          onPress={onSignInPress}
          disabled={
            isLoading ||
            isGoogleLoading ||
            !emailAddress.trim() ||
            !password.trim()
          }
        >
          <Text style={[styles.primaryButtonText]}>
            {isLoading ? "Signing in..." : "Sign In"}
          </Text>
        </TouchableOpacity>

        <View style={styles.dividerContainer}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={[
            styles.googleButton,
            (isLoading || isGoogleLoading) && styles.disabledButton,
          ]}
          onPress={onGoogleSignInPress}
          disabled={isLoading || isGoogleLoading}
        >
          <GoogleLogo width={20} height={20} />
          <Text style={styles.googleButtonText}>
            {isGoogleLoading ? "Signing in..." : "Continue with Google"}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "white",
    fontWeight: "600",
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    paddingHorizontal: 12,
    color: colors.secondaryLabel,
    fontSize: 12,
    textTransform: "uppercase",
  },
  googleButton: {
    backgroundColor: colors.adaptiveWhite,
    borderColor: colors.border,
    borderWidth: borderWidths.hairline,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
  },
  googleButtonText: {
    color: colors.label,
    fontWeight: "600",
  },
});
