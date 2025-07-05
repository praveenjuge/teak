import React, { useState, useEffect } from "react";
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
import {
  authClient,
  storeApiUrl,
  getStoredApiUrl,
} from "../../lib/auth-client";
import { reloadAppAsync } from "expo";

export default function Login() {
  const [step, setStep] = useState<"server" | "login">("server");
  const [apiUrl, setApiUrl] = useState(
    __DEV__ ? "http://192.168.29.57:3000" : ""
  );
  const [email, setEmail] = useState(__DEV__ ? "hello@praveenjuge.com" : "");
  const [password, setPassword] = useState(__DEV__ ? "asdfghjkl;'" : "");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingStoredUrl, setIsCheckingStoredUrl] = useState(true);

  useEffect(() => {
    const checkStoredUrl = async () => {
      try {
        const storedUrl = await getStoredApiUrl();
        if (storedUrl && storedUrl.trim()) {
          setApiUrl(storedUrl);
          setStep("login");
        }
      } catch (error) {
        console.error("Error checking stored URL:", error);
      } finally {
        setIsCheckingStoredUrl(false);
      }
    };

    checkStoredUrl();
  }, []);

  const handleServerContinue = async () => {
    if (!apiUrl.trim()) {
      Alert.alert("Error", "Please enter a server URL");
      return;
    }

    setIsLoading(true);

    try {
      console.log("Testing connection to server URL:", apiUrl);

      // Validate if this is a Teak server
      const formattedURL = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
      const healthCheckUrl = `${formattedURL}/api/health`;

      console.log("Checking server health at:", healthCheckUrl);

      const response = await fetch(healthCheckUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }

      const healthData = await response.json();
      console.log("Server health response:", healthData);

      // Check if the response indicates this is a Teak server
      if (!healthData || healthData.service !== "teak") {
        Alert.alert(
          "Invalid Server",
          "This doesn't appear to be a Teak server. Please check your server URL."
        );
        return;
      }

      // Store the API URL for future use
      await storeApiUrl(apiUrl);

      console.log("Stored API URL:", apiUrl);

      // Force reload the entire app to reinitialize with new server URL
      await reloadAppAsync();
    } catch (error) {
      console.error("Server URL error:", error);

      let errorMessage =
        "Unable to connect to the server. Please check your server URL and network connection.";

      if (error instanceof Error) {
        if (error.message.includes("Network request failed")) {
          errorMessage =
            "Network error. Please check your internet connection and server URL.";
        } else if (error.message.includes("status: 404")) {
          errorMessage =
            "Server not found. This may not be a Teak server or the URL is incorrect.";
        } else if (error.message.includes("status: 500")) {
          errorMessage =
            "Server error. The Teak server may be experiencing issues.";
        }
      }

      Alert.alert("Connection Error", errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    setIsLoading(true);

    try {
      console.log("Attempting login with stored URL");

      // Attempt to sign in using the main auth client
      if (!authClient) {
        Alert.alert(
          "Auth Error",
          "Authentication client is not initialized. Please check your server URL and try again."
        );
        return;
      }

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
      }
    } catch (error) {
      console.error("Login error:", error);
      Alert.alert(
        "Connection Error",
        "Unable to connect to the server. Please check your credentials."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToServer = () => {
    setStep("server");
  };

  // Show loading screen while checking for stored URL
  if (isCheckingStoredUrl) {
    return (
      <View
        style={[styles.stepContainer, { flex: 1, justifyContent: "center" }]}
      >
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={[styles.stepDescription, { marginTop: 16 }]}>
          Checking server configuration...
        </Text>
      </View>
    );
  }

  if (step === "server") {
    return (
      <ScrollView
        style={{ padding: 20 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.stepContainer}>
          <Text style={styles.stepTitle}>Connect to Server</Text>
          <Text style={styles.stepDescription}>
            Enter your Teak server URL to continue
          </Text>
        </View>

        {/* API URL Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="https://teak.example.com"
            placeholderTextColor="#8E8E93"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
          />
        </View>

        {/* Continue Button */}
        <TouchableOpacity
          style={[
            styles.loginButton,
            (!apiUrl.trim() || isLoading) && styles.loginButtonDisabled,
          ]}
          onPress={handleServerContinue}
          disabled={!apiUrl.trim() || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.loginButtonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ padding: 20 }}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Sign In</Text>
        <Text style={styles.stepDescription}>
          Enter your credentials to access your account
        </Text>
        <Text style={styles.serverInfo}>Server: {apiUrl}</Text>
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
          (!email || !password || isLoading) && styles.loginButtonDisabled,
        ]}
        onPress={handleLogin}
        disabled={!email || !password || isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.loginButtonText}>Sign In</Text>
        )}
      </TouchableOpacity>

      {/* Back Button */}
      <TouchableOpacity style={styles.backButton} onPress={handleBackToServer}>
        <Text style={styles.backButtonText}>Change Server</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stepContainer: {
    marginBottom: 30,
    alignItems: "center",
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#000000",
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 16,
    color: "#8E8E93",
    textAlign: "center",
    lineHeight: 22,
  },
  serverInfo: {
    fontSize: 12,
    color: "#8E8E93",
    textAlign: "center",
    marginTop: 8,
    fontStyle: "italic",
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    color: "#8E8E93",
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  loginButton: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  loginButtonDisabled: {
    backgroundColor: "#8E8E93",
  },
  loginButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  backButton: {
    backgroundColor: "transparent",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#007AFF",
  },
  backButtonText: {
    color: "#007AFF",
    fontWeight: "600",
  },
});
