import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { authClient, getStoredApiUrl, storeApiUrl } from "../lib/auth-client";

export default function Login() {
  const [apiUrl, setApiUrl] = useState(
    __DEV__ ? "http://192.168.29.57:3000" : ""
  );
  const [email, setEmail] = useState(__DEV__ ? "hello@praveenjuge.com" : "");
  const [password, setPassword] = useState(__DEV__ ? "asdfghjkl;'" : "");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const hasNavigatedRef = useRef(false);

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
    if (!isPending && !isInitializing && session && !hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      // Use setTimeout to prevent navigation during render cycle
      setTimeout(() => {
        router.replace("/(tabs)");
      }, 0);
    } else if (!isPending && !isInitializing && !session) {
      // Reset the navigation flag when session is cleared
      hasNavigatedRef.current = false;
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
      <ScrollView
        style={{ flex: 1, padding: 20 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>
            {isInitializing ? "Initializing..." : "Checking authentication..."}
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, padding: 20 }}
      contentInsetAdjustmentBehavior="automatic"
    >
      {/* API URL Input */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Server URL</Text>
        <TextInput
          style={styles.input}
          value={apiUrl}
          onChangeText={setApiUrl}
          placeholder={
            __DEV__ ? "http://192.168.29.57:3000" : "https://teak.example.com"
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    color: "#8E8E93",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  loginButton: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  loginButtonDisabled: {
    backgroundColor: "#8E8E93",
  },
  loginButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 16,
    color: "#8E8E93",
  },
});
