import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { colors } from '../../constants/colors';
import { authClient, getStoredApiUrl } from '../../lib/auth-client';

export default function SettingsScreen() {
  const { data: session } = authClient?.useSession() || { data: null };
  const serverUrl = getStoredApiUrl();

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            if (authClient) {
              await authClient.signOut();
            } else {
              Alert.alert('Error', 'Authentication client not available');
            }
          } catch {
            Alert.alert('Error', 'Failed to logout');
          }
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={styles.labelTitle}>{session?.user?.email}</Text>
      <Text style={styles.labelTitle}>{session?.user?.id}</Text>
      <Text style={styles.labelTitle}>{serverUrl || 'Not Configured'}</Text>
      <TouchableOpacity onPress={handleLogout} style={styles.settingItem}>
        <Text style={styles.settingTitle}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 20, flex: 1 },
  labelTitle: {
    color: colors.label,
  },
  settingItem: {
    padding: 14,
    marginVertical: 20,
    backgroundColor: colors.systemRed,
    borderRadius: 12,
    alignItems: 'center',
  },
  settingTitle: {
    fontWeight: '500',
    color: colors.adaptiveWhite,
  },
});
