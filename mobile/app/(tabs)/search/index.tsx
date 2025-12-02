import { useState } from "react";
import {
  NativeSyntheticEvent,
  StyleSheet,
  View,
  ScrollView,
} from "react-native";
import { Stack } from "expo-router";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { CardsGrid } from "@/components/CardsGrid";

export default function SearchScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Search",
          headerSearchBarOptions: {
            placement: "automatic",
            placeholder: "Search cards...",
            onChangeText: (event: NativeSyntheticEvent<{ text: string }>) => {
              setSearchQuery(event.nativeEvent.text);
            },
          },
        }}
      />
      <ScrollView style={{ flex: 1, marginTop: 80 }}>
        <CardsGrid searchQuery={debouncedSearchQuery} />
      </ScrollView>
    </>
  );
}
