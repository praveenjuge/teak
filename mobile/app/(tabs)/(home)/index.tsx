import { CardsGrid } from "@/components/CardsGrid";
import { Stack } from "expo-router";
import { useCallback, useState } from "react";
import { Platform } from "react-native";

type SearchBarEvent = {
  nativeEvent: {
    text: string;
  };
};

export default function HomeScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const handleSearchChange = useCallback((event: SearchBarEvent) => {
    setSearchQuery(event.nativeEvent.text);
  }, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Home",
          headerTransparent: false,
          ...(Platform.OS === "ios"
            ? {
                headerSearchBarOptions: {
                  placeholder: "Search",
                  autoCapitalize: "none",
                  onChangeText: handleSearchChange,
                  onCancelButtonPress: () => setSearchQuery(""),
                },
              }
            : {}),
        }}
      />
      <CardsGrid searchQuery={searchQuery} />
    </>
  );
}
