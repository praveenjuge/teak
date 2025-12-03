import { useState } from "react";
import { NativeSyntheticEvent, View } from "react-native";
import { Stack } from "expo-router";
import { Host, Spacer, Text, HStack } from "@expo/ui/swift-ui";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { CardsGrid } from "@/components/CardsGrid";

export default function SearchScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const trimmedSearchQuery = searchQuery.trim();
  const debouncedSearchQuery = useDebouncedValue(trimmedSearchQuery, 200);
  const hasSearchQuery = debouncedSearchQuery.length > 0;

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
      {hasSearchQuery ? (
        <CardsGrid searchQuery={debouncedSearchQuery} />
      ) : (
        <Host matchContents useViewportSizeMeasurement style={{ flex: 1 }}>
          <HStack alignment="center">
            <Spacer />
            <Text weight="semibold" size={16}>
              Start searching for cards!
            </Text>
            <Spacer />
          </HStack>
        </Host>
      )}
    </>
  );
}
