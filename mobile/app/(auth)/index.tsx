import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Logo from "../../components/Logo";
import { LinearGradient } from "expo-linear-gradient";
import { colors, borderWidths } from "@/constants/colors";
import GoogleLogo from "@/components/GoogleLogo";
import { authClient } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/getAuthErrorMessage";

export default function OnboardingScreen() {
  const [isGoogleLoading, setIsGoogleLoading] = React.useState(false);

  const onGoogleSignInPress = async () => {
    if (isGoogleLoading) return;
    setIsGoogleLoading(true);

    try {
      const response = await authClient.signIn.social({
        provider: "google",
        callbackURL: "teak://",
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
    <>
      <LinearGradient
        colors={[
          "#000000",
          "#000c4f",
          "#5b8183",
          "#ffb244",
          colors.primary,
          "#000000",
        ]}
        style={styles.background}
      />
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View>
            <View style={styles.logoContainer}>
              <Logo variant="white" width={94} />
            </View>

            <View style={styles.textContainer}>
              <Text style={styles.title}>Save Anything. Anywhere.</Text>
              <Text style={styles.subtitle}>
                Your personal everything management system. Organize, save, and
                access all your text, images, and documents in one place.
              </Text>
            </View>
          </View>

          <View style={styles.buttonContainer}>
            <Link href="/sign-up" asChild>
              <TouchableOpacity style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Sign Up →</Text>
              </TouchableOpacity>
            </Link>

            <TouchableOpacity
              style={[
                styles.googleButton,
                isGoogleLoading && styles.disabledButton,
              ]}
              onPress={onGoogleSignInPress}
              disabled={isGoogleLoading}
            >
              <GoogleLogo width={20} height={20} />
              <Text style={styles.googleButtonText}>
                {isGoogleLoading ? "Signing in..." : "Continue with Google"}
              </Text>
            </TouchableOpacity>

            <Link href="/sign-in" asChild>
              <TouchableOpacity style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>
                  Have an Account? Login
                </Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    height: "100%",
    width: "100%",
    zIndex: -1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 34,
    paddingTop: 48,
    paddingBottom: 30,
    justifyContent: "space-between",
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 22,
  },
  textContainer: {
    alignItems: "center",
    marginBottom: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "white",
    marginBottom: 10,
  },
  subtitle: {
    lineHeight: 20,
    color: "white",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  buttonContainer: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: "white",
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  primaryButtonText: {
    color: "black",
    fontWeight: "600",
  },
  googleButton: {
    backgroundColor: "white",
    borderColor: colors.border,
    borderWidth: borderWidths.hairline,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 50,
  },
  googleButtonText: {
    color: "black",
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.6,
  },
  secondaryButton: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  secondaryButtonText: {
    color: "white",
    fontWeight: "600",
  },
});
