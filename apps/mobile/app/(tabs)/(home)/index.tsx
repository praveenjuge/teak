import { Stack } from "expo-router";
import { useCallback, useState } from "react";
import { CardsGrid } from "@/components/CardsGrid";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";

const SEARCH_DEBOUNCE_MS = 250;

interface SearchBarEvent {
  nativeEvent: {
    text: string;
  };
}

export default function HomeScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(
    searchQuery,
    SEARCH_DEBOUNCE_MS
  );

  const handleSearchChange = useCallback((event: SearchBarEvent) => {
    setSearchQuery(event.nativeEvent.text);
  }, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Home",
          headerLargeTitle: true,
        }}
      />
      <Stack.SearchBar
        autoCapitalize="none"
        hideWhenScrolling={false}
        onCancelButtonPress={() => setSearchQuery("")}
        onChangeText={handleSearchChange as any}
        placeholder="Search"
      />
      <CardsGrid searchQuery={debouncedSearchQuery} />
    </>
  );
}
