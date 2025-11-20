import { ScrollView, StyleSheet, Text } from "react-native";
import { colors } from "../../constants/colors";
import { SignOutButton } from "@/components/SignOutButton";
import { authClient } from "@/lib/auth-client";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={styles.labelTitle}>
        {session?.user?.email ?? "Not logged in"}
      </Text>
      <SignOutButton />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 24, gap: 24, flex: 1 },
  labelTitle: {
    color: colors.label,
  },
});
