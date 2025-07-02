import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { authClient, getStoredApiUrl, storeApiUrl } from "../lib/auth-client";

export default function Login() {
  const [apiUrl, setApiUrl] = useState(
    __DEV__ ? "http://192.168.29.57:3001" : ""
  );
  const [email, setEmail] = useState(__DEV__ ? "hello@praveenjuge.com" : "");
  const [password, setPassword] = useState(__DEV__ ? "asdfghjkl;'" : "");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Check for existing session
  const { data: session, isPending } = authClient.useSession();

  // Initialize with stored API URL
  useEffect(() => {
    const initializeApiUrl = async () => {
      try {
        const storedUrl = await getStoredApiUrl();
        if (storedUrl) {
          setApiUrl(storedUrl);
        }
      } catch (error) {
        console.error("Failed to load stored API URL:", error);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeApiUrl();
  }, []);

  // Redirect to home if already logged in
  useEffect(() => {
    if (!isPending && !isInitializing && session) {
      router.replace("/(tabs)");
    }
  }, [session, isPending, isInitializing]);

  const handleLogin = async () => {
    if (!apiUrl || !email || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    setIsLoading(true);

    try {
      console.log("Attempting login with URL:", apiUrl);

      // Store the API URL for future use
      await storeApiUrl(apiUrl);

      // Attempt to sign in using the main auth client
      const result = await authClient.signIn.email({
        email,
        password,
      });

      console.log("Login result:", result);

      if (result.error) {
        console.error("Login failed:", result.error);
        Alert.alert(
          "Login Failed",
          result.error.message || "Invalid credentials"
        );
      } else {
        console.log("Login successful!");

        // Login successful - navigate to home screen
        // The session should automatically update via the useSession hook
        router.replace("/(tabs)");
      }
    } catch (error) {
      console.error("Login error:", error);
      Alert.alert(
        "Connection Error",
        "Unable to connect to the server. Please check your server URL and network connection."
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading while checking for existing session or initializing
  if (isPending || isInitializing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.formContainer, styles.centerContent]}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={[styles.subtitle, { marginTop: 16 }]}>
            {isInitializing ? "Initializing..." : "Checking authentication..."}
          </Text>
        </View>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Sign In</Text>
          </View>

          {/* Form Container */}
          <View style={styles.formContainer}>
            <Text style={styles.subtitle}>
              Sign in to your account to continue
            </Text>

            {/* API URL Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Server URL</Text>
              <TextInput
                style={styles.input}
                value={apiUrl}
                onChangeText={setApiUrl}
                placeholder={
                  __DEV__
                    ? "http://192.168.29.57:3001"
                    : "https://teak.example.com"
                }
                placeholderTextColor="#8E8E93"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                textContentType="URL"
              />
            </View>

            {/* Email Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor="#8E8E93"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
              />
            </View>

            {/* Password Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor="#8E8E93"
                secureTextEntry
                textContentType="password"
              />
            </View>

            {/* Login Button */}
            <TouchableOpacity
              style={[
                styles.loginButton,
                (!apiUrl || !email || !password || isLoading) &&
                  styles.loginButtonDisabled,
              ]}
              onPress={handleLogin}
              disabled={!apiUrl || !email || !password || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.loginButtonText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: "center",
    paddingBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#000000",
  },
  formContainer: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 60,
  },
  subtitle: {
    fontSize: 15,
    color: "#8E8E93",
    textAlign: "center",
    marginBottom: 40,
    lineHeight: 20,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: "400",
    color: "#8E8E93",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    padding: 16,
    fontSize: 17,
    color: "#000000",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  loginButton: {
    backgroundColor: "#007AFF",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginTop: 20,
    shadowColor: "#007AFF",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  loginButtonDisabled: {
    backgroundColor: "#8E8E93",
    shadowOpacity: 0,
    elevation: 0,
  },
  loginButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  forgotPasswordButton: {
    alignItems: "center",
    marginTop: 20,
    padding: 12,
  },
  forgotPasswordText: {
    color: "#007AFF",
    fontSize: 15,
    fontWeight: "400",
  },
  centerContent: {
    alignItems: "center",
    justifyContent: "center",
  },
});
