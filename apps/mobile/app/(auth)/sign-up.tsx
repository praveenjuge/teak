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
import { useSignUp } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import { colors, borderWidths } from "../../constants/colors";

export default function SignUpScreen() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pendingVerification, setPendingVerification] = React.useState(false);
  const [code, setCode] = React.useState("");

  // Handle submission of sign-up form
  const onSignUpPress = async () => {
    if (!isLoaded || isLoading) return;

    if (!emailAddress.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter both email and password.");
      return;
    }

    if (password.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters long.");
      return;
    }

    setIsLoading(true);

    try {
      await signUp.create({
        emailAddress: emailAddress.trim(),
        password,
      });

      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setPendingVerification(true);
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      Alert.alert(
        "Sign Up Failed",
        err.errors?.[0]?.message ||
          "Failed to create account. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Handle submission of verification form
  const onVerifyPress = async () => {
    if (!isLoaded || isLoading) return;

    if (!code.trim()) {
      Alert.alert("Error", "Please enter the verification code.");
      return;
    }

    setIsLoading(true);

    try {
      const signUpAttempt = await signUp.attemptEmailAddressVerification({
        code: code.trim(),
      });

      if (signUpAttempt.status === "complete") {
        await setActive({ session: signUpAttempt.createdSessionId });
        router.replace("/(tabs)");
      } else {
        console.error(JSON.stringify(signUpAttempt, null, 2));
        Alert.alert("Error", "Verification incomplete. Please try again.");
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      Alert.alert(
        "Verification Failed",
        err.errors?.[0]?.message ||
          "Invalid verification code. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (pendingVerification) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoidingView}
      >
        <View style={styles.content}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Verification Code</Text>
            <TextInput
              style={styles.textInput}
              value={code}
              placeholder="Enter 6-digit code"
              placeholderTextColor={colors.secondaryLabel}
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="one-time-code"
              onChangeText={setCode}
              editable={!isLoading}
            />
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              (isLoading || !code.trim()) && styles.disabledButton,
            ]}
            onPress={onVerifyPress}
            disabled={isLoading || !code.trim()}
          >
            <Text style={[styles.primaryButtonText]}>
              {isLoading ? "Verifying..." : "Verify Email"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

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
            (isLoading || !emailAddress.trim() || !password.trim()) &&
              styles.disabledButton,
          ]}
          onPress={onSignUpPress}
          disabled={isLoading || !emailAddress.trim() || !password.trim()}
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
