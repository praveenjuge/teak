import { useSignIn } from "@clerk/clerk-expo";
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
import { SafeAreaView } from "react-native-safe-area-context";
import React from "react";
import { colors, borderWidths } from "../../constants/colors";

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);

  // if dev, email and password is hello@praveenjuge.com
  const [emailAddress, setEmailAddress] = React.useState(
    "hello@praveenjuge.com"
  );
  const [password, setPassword] = React.useState("hello@praveenjuge.com");

  // Handle the submission of the sign-in form
  const onSignInPress = async () => {
    if (!isLoaded || isLoading) return;

    if (!emailAddress.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter both email and password.");
      return;
    }

    setIsLoading(true);

    try {
      const signInAttempt = await signIn.create({
        identifier: emailAddress.trim(),
        password,
      });

      if (signInAttempt.status === "complete") {
        await setActive({ session: signInAttempt.createdSessionId });
        router.replace("/(tabs)");
      } else {
        console.error(JSON.stringify(signInAttempt, null, 2));
        Alert.alert("Error", "Sign in incomplete. Please try again.");
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      Alert.alert(
        "Sign In Failed",
        err.errors?.[0]?.message ||
          "Invalid email or password. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
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
              (isLoading || !emailAddress.trim() || !password.trim()) &&
                styles.disabledButton,
            ]}
            onPress={onSignInPress}
            disabled={isLoading || !emailAddress.trim() || !password.trim()}
          >
            <Text style={[styles.primaryButtonText]}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    paddingHorizontal: 24,
    gap: 24,
    marginBottom: 32,
  },
  inputGroup: {
    gap: 8,
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
});
