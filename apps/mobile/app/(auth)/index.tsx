import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Logo from "../../components/Logo";
import { LinearGradient } from "expo-linear-gradient";

export default function OnboardingScreen() {
  return (
    <>
      <LinearGradient
        colors={[
          "#000000",
          "#000c4f",
          "#5b8183",
          "#e8cd7e",
          "#ffb244",
          "#9e4700",
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
    textAlign: "center",
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
    minHeight: 48,
  },
  primaryButtonText: {
    color: "black",
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "transparent",
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryButtonText: {
    color: "white",
    fontWeight: "500",
  },
});
