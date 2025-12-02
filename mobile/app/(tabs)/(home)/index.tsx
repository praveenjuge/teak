import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { CardsGrid } from "@/components/CardsGrid";
import { SearchInput } from "@/components/SearchInput";
import { Stack } from "expo-router";

export default function HomeScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string | undefined>();
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Home",
        }}
      />
      <SearchInput
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedType={selectedType}
        setSelectedType={setSelectedType}
      />
      <View style={styles.gridContainer}>
        <CardsGrid
          searchQuery={debouncedSearchQuery}
          selectedType={selectedType}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    flex: 1,
  },
});
