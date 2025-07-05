import React from "react";
import { View, TextInput, StyleSheet, Platform } from "react-native";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { useSearch } from "@/lib/SearchContext";
import { colors, borderWidths } from "@/constants/colors";

export function SearchInput() {
  const { searchQuery, setSearchQuery } = useSearch();

  const dynamicStyles = {
    container: {
      backgroundColor: colors.background,
      borderColor: colors.border,
    },
    input: {
      color: colors.label,
    },
    icon: {
      color: colors.secondaryLabel,
    },
  };

  return (
    <View style={[styles.container, dynamicStyles.container]}>
      <IconSymbol
        name="magnifyingglass"
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
    borderBottomWidth: borderWidths.hairline,
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
