import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  useColorScheme,
} from "react-native";
import { authClient } from "../../lib/auth-client";
import { CardsGrid } from "../../components/CardsGrid";

export default function HomeScreen() {
  const { data: session } = authClient.useSession();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const dynamicStyles = {
    container: {
      backgroundColor: isDark ? "#000" : "#f5f5f5",
    },
    header: {
      backgroundColor: isDark ? "#1f1f1f" : "#fff",
      borderBottomColor: isDark ? "#333" : "#e0e0e0",
    },
    title: {
      color: isDark ? "#fff" : "#333",
    },
    subtitle: {
      color: isDark ? "#ccc" : "#666",
    },
  };

  return (
    <SafeAreaView style={[styles.container, dynamicStyles.container]}>
      <View style={[styles.header, dynamicStyles.header]}>
        <Text style={[styles.title, dynamicStyles.title]}>Welcome back!</Text>
        <Text style={[styles.subtitle, dynamicStyles.subtitle]}>
          {session?.user?.email}
        </Text>
      </View>

      <CardsGrid />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
  },
});
