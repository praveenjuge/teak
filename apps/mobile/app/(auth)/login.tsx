import { reloadAppAsync } from 'expo';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { borderWidths, colors } from '../../constants/colors';
import {
  authClient,
  getStoredApiUrl,
  storeApiUrl,
} from '../../lib/auth-client';

export default function Login() {
  const [step, setStep] = useState<'server' | 'login'>('server');
  const [apiUrl, setApiUrl] = useState(
    // biome-ignore lint/correctness/noUndeclaredVariables: defined from expo
    __DEV__ ? 'http://172.19.189.105:3000' : ''
  );
  // biome-ignore lint/correctness/noUndeclaredVariables: defined from expo
  const [email, setEmail] = useState(__DEV__ ? 'hello@praveenjuge.com' : '');
  // biome-ignore lint/correctness/noUndeclaredVariables: defined from expo
  const [password, setPassword] = useState(__DEV__ ? "asdfghjkl;'" : '');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const checkStoredUrl = () => {
      try {
        const storedUrl = getStoredApiUrl();
        if (storedUrl?.trim()) {
          setApiUrl(storedUrl);
          setStep('login');
        }
      } catch (error) {
        console.error('Error checking stored URL:', error);
      }
    };

    checkStoredUrl();
  }, []);

  const handleServerContinue = async () => {
    if (!apiUrl.trim()) {
      Alert.alert('Error', 'Please enter a server URL');
      return;
    }

    setIsLoading(true);

    try {
      console.log('Testing connection to server URL:', apiUrl);

      // Validate if this is a Teak server
      const formattedURL = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
      const healthCheckUrl = `${formattedURL}/api/health`;

      console.log('Checking server health at:', healthCheckUrl);

      const response = await fetch(healthCheckUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }

      const healthData = await response.json();
      console.log('Server health response:', healthData);

      // Check if the response indicates this is a Teak server
      if (!healthData || healthData.service !== 'teak-backend') {
        Alert.alert(
          'Invalid Server',
          "This doesn't appear to be a Teak server. Please check your server URL."
        );
        return;
      }

      // Store the API URL for future use
      await storeApiUrl(apiUrl);

      console.log('Stored API URL:', apiUrl);

      // Force reload the entire app to reinitialize with new server URL
      await reloadAppAsync();
    } catch (error) {
      console.error('Server URL error:', error);

      let errorMessage =
        'Unable to connect to the server. Please check your server URL and network connection.';

      if (error instanceof Error) {
        if (error.message.includes('Network request failed')) {
          errorMessage =
            'Network error. Please check your internet connection and server URL.';
        } else if (error.message.includes('status: 404')) {
          errorMessage =
            'Server not found. This may not be a Teak server or the URL is incorrect.';
        } else if (error.message.includes('status: 500')) {
          errorMessage =
            'Server error. The Teak server may be experiencing issues.';
        }
      }

      Alert.alert('Connection Error', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!(email && password)) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setIsLoading(true);

    try {
      console.log('Attempting login with stored URL');

      // Attempt to sign in using the main auth client
      if (!authClient) {
        Alert.alert(
          'Auth Error',
          'Authentication client is not initialized. Please check your server URL and try again.'
        );
        return;
      }

      const result = await authClient.signIn.email({
        email,
        password,
      });

      console.log('Login result:', result);

      if (result.error) {
        console.error('Login failed:', result.error);
        Alert.alert(
          'Login Failed',
          result.error.message || 'Invalid credentials'
        );
      }
    } catch (error) {
      console.error('Login error:', error);
      Alert.alert(
        'Connection Error',
        'Unable to connect to the server. Please check your credentials.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToServer = () => {
    setStep('server');
  };

  if (step === 'server') {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ padding: 20 }}
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
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setApiUrl}
            placeholder="https://teak.example.com"
            style={styles.input}
            textContentType="URL"
            value={apiUrl}
          />
        </View>

        {/* Continue Button */}
        <TouchableOpacity
          disabled={!apiUrl.trim() || isLoading}
          onPress={handleServerContinue}
          style={[
            styles.loginButton,
            (!apiUrl.trim() || isLoading) && styles.loginButtonDisabled,
          ]}
        >
          {isLoading ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.loginButtonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ padding: 20 }}
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
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Enter your email"
          style={styles.input}
          textContentType="emailAddress"
          value={email}
        />
      </View>

      {/* Password Input */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          onChangeText={setPassword}
          placeholder="Enter your password"
          secureTextEntry
          style={styles.input}
          textContentType="password"
          value={password}
        />
      </View>

      {/* Login Button */}
      <TouchableOpacity
        disabled={!(email && password) || isLoading}
        onPress={handleLogin}
        style={[
          styles.loginButton,
          (!(email && password) || isLoading) && styles.loginButtonDisabled,
        ]}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.adaptiveWhite} />
        ) : (
          <Text style={styles.loginButtonText}>Sign In</Text>
        )}
      </TouchableOpacity>

      {/* Back Button */}
      <TouchableOpacity onPress={handleBackToServer} style={styles.backButton}>
        <Text style={styles.backButtonText}>Change Server</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stepContainer: {
    marginBottom: 16,
  },
  stepTitle: {
    fontWeight: 'bold',
    marginBottom: 6,
    color: colors.label,
  },
  stepDescription: {
    color: colors.secondaryLabel,
    marginBottom: 6,
  },
  serverInfo: {
    color: colors.secondaryLabel,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    color: colors.secondaryLabel,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: 14,
    borderWidth: borderWidths.hairline,
    borderColor: colors.border,
    color: colors.label,
  },
  loginButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  loginButtonDisabled: {
    opacity: 0.3,
  },
  loginButtonText: {
    color: colors.adaptiveWhite,
    fontWeight: '600',
  },
  backButton: {
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    borderWidth: borderWidths.hairline,
    borderColor: colors.primary,
  },
  backButtonText: {
    color: colors.primary,
    fontWeight: '600',
  },
});
