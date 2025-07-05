import React from "react";
import {
  View,
  TextInput,
  StyleSheet,
  useColorScheme,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSearch } from "@/lib/SearchContext";

export function SearchInput() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const { searchQuery, setSearchQuery } = useSearch();

  const dynamicStyles = {
    container: {
      backgroundColor: isDark ? "#1c1c1e" : "#fff",
      borderColor: isDark ? "#38383a" : "#d1d1d6",
    },
    input: {
      color: isDark ? "#ffffff" : "#000000",
    },
    icon: {
      color: isDark ? "#8e8e93" : "#8e8e93",
    },
  };

  return (
    <View style={[styles.container, dynamicStyles.container]}>
      <Ionicons
        name="search"
        size={20}
        color={dynamicStyles.icon.color}
        style={styles.searchIcon}
      />
      <TextInput
        style={[styles.input, dynamicStyles.input]}
        placeholder="Search cards..."
        value={searchQuery}
        onChangeText={setSearchQuery}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    ...Platform.select({
      ios: {
        paddingVertical: 0,
      },
      android: {
        paddingVertical: 4,
      },
    }),
  },
});
