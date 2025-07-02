import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { authClient, getStoredApiUrl } from "../../lib/auth-client";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const [serverUrl, setServerUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    getStoredApiUrl()
      .then(setServerUrl)
      .catch(() => setServerUrl(null));
  }, []);

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          try {
            await authClient.signOut();
          } catch {
            Alert.alert("Error", "Failed to logout");
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text>{session?.user?.email}</Text>
          <Text>{session?.user?.id}</Text>
          <Text>{serverUrl || "Not Configured"}</Text>
        </View>
        <View style={styles.section}>
          <TouchableOpacity style={styles.settingItem} onPress={handleLogout}>
            <Text style={styles.settingTitle}>Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  section: { marginBottom: 24 },
  settingItem: {
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  settingTitle: {
    fontWeight: "500",
    color: "#dc2626",
  },
});
