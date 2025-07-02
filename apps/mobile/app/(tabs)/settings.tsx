import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  Share,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { authClient, getStoredApiUrl } from "../../lib/auth-client";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);

  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          try {
            await authClient.signOut();
            router.replace("/");
          } catch (error) {
            console.error("Logout error:", error);
            Alert.alert("Error", "Failed to logout");
          }
        },
      },
    ]);
  };

  const handleShareApp = async () => {
    try {
      await Share.share({
        message: "Check out Teak - an awesome app for organizing your items!",
        title: "Teak App",
      });
    } catch (error) {
      console.error("Share error:", error);
    }
  };

  const handleServerInfo = async () => {
    try {
      const apiUrl = await getStoredApiUrl();
      Alert.alert(
        "Server Information",
        `Connected to: ${apiUrl || "Not configured"}`,
        [{ text: "OK" }]
      );
    } catch (error) {
      Alert.alert("Error", "Unable to retrieve server information");
    }
  };

  const handleAbout = () => {
    Alert.alert(
      "About Teak",
      "Teak v1.0.0\n\nA simple and elegant app for organizing your items and staying productive.\n\nMade with ❤️ using React Native and Expo.",
      [{ text: "OK" }]
    );
  };

  const SettingItem = ({
    icon,
    title,
    subtitle,
    onPress,
    showArrow = true,
    rightComponent,
    danger = false,
    isLast = false,
  }: {
    icon: string;
    title: string;
    subtitle?: string;
    onPress?: () => void;
    showArrow?: boolean;
    rightComponent?: React.ReactNode;
    danger?: boolean;
    isLast?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.settingItem, !isLast && styles.settingItemWithBorder]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.settingLeft}>
        <View
          style={[styles.iconContainer, danger && styles.dangerIconContainer]}
        >
          <Ionicons
            name={icon as any}
            size={20}
            color={danger ? "#dc2626" : "#6b7280"}
          />
        </View>
        <View style={styles.settingContent}>
          <Text style={[styles.settingTitle, danger && styles.dangerText]}>
            {title}
          </Text>
          {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
        </View>
      </View>
      <View style={styles.settingRight}>
        {rightComponent}
        {showArrow && !rightComponent && (
          <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* User Info Section */}
        <View style={styles.section}>
          <View style={styles.userInfo}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={32} color="#6b7280" />
            </View>
            <View style={styles.userDetails}>
              <Text style={styles.userName}>
                {session?.user?.name || session?.user?.email?.split("@")[0]}
              </Text>
              <Text style={styles.userEmail}>{session?.user?.email}</Text>
            </View>
          </View>
        </View>

        {/* Preferences Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          <View style={styles.settingGroup}>
            <SettingItem
              icon="notifications"
              title="Notifications"
              subtitle="Receive push notifications"
              showArrow={false}
              rightComponent={
                <Switch
                  value={notificationsEnabled}
                  onValueChange={setNotificationsEnabled}
                  trackColor={{ false: "#e5e7eb", true: "#2563eb" }}
                  thumbColor="#ffffff"
                />
              }
            />
            <SettingItem
              icon="moon"
              title="Dark Mode"
              subtitle="Use dark theme"
              showArrow={false}
              rightComponent={
                <Switch
                  value={darkModeEnabled}
                  onValueChange={setDarkModeEnabled}
                  trackColor={{ false: "#e5e7eb", true: "#2563eb" }}
                  thumbColor="#ffffff"
                />
              }
            />
            <SettingItem
              icon="sync"
              title="Auto Sync"
              subtitle="Automatically sync data"
              showArrow={false}
              isLast={true}
              rightComponent={
                <Switch
                  value={autoSyncEnabled}
                  onValueChange={setAutoSyncEnabled}
                  trackColor={{ false: "#e5e7eb", true: "#2563eb" }}
                  thumbColor="#ffffff"
                />
              }
            />
          </View>
        </View>

        {/* App Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App</Text>
          <View style={styles.settingGroup}>
            <SettingItem
              icon="server"
              title="Server Info"
              subtitle="View connection details"
              onPress={handleServerInfo}
            />
            <SettingItem
              icon="share"
              title="Share App"
              subtitle="Tell others about Teak"
              onPress={handleShareApp}
            />
            <SettingItem
              icon="information-circle"
              title="About"
              subtitle="App version and info"
              onPress={handleAbout}
              isLast={true}
            />
          </View>
        </View>

        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.settingGroup}>
            <SettingItem
              icon="log-out"
              title="Logout"
              subtitle="Sign out of your account"
              onPress={handleLogout}
              danger={true}
              isLast={true}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  userInfo: {
    backgroundColor: "#ffffff",
    padding: 20,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 4,
    textTransform: "capitalize",
  },
  userEmail: {
    fontSize: 14,
    color: "#6b7280",
  },
  settingGroup: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  settingItemWithBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  dangerIconContainer: {
    backgroundColor: "#fef2f2",
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1f2937",
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 14,
    color: "#6b7280",
  },
  settingRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  dangerText: {
    color: "#dc2626",
  },
});
