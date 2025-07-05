import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  useColorScheme,
} from "react-native";
import { CardsGrid } from "../../components/CardsGrid";

export default function HomeScreen() {
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
      <CardsGrid />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
