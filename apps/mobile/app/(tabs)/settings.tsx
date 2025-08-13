import { ScrollView, StyleSheet, Text } from "react-native";
import { useUser } from "@clerk/clerk-expo";
import { colors } from "../../constants/colors";
import { SignOutButton } from "@/components/SignOutButton";

export default function SettingsScreen() {
  const { user } = useUser();

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={styles.labelTitle}>
        {user?.primaryEmailAddress?.emailAddress || "Not logged in"}
      </Text>
      <Text style={styles.labelTitle}>ID: {user?.id || "Not logged in"}</Text>
      <SignOutButton />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 20, flex: 1 },
  labelTitle: {
    color: colors.label,
    marginBottom: 8,
  },
});
