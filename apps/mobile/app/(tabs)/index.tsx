import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { useState, useCallback } from "react";
import { authClient } from "../../lib/auth-client";

export default function HomeScreen() {
  const { data: session } = authClient.useSession();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back!</Text>
        <Text>{session?.user?.email}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: 20,
  },
  card: {
    backgroundColor: "lightblue",
    padding: 20,
    borderRadius: 12,
    elevation: 2,
  },
  title: {
    fontWeight: "bold",
    marginBottom: 6,
  },
});
