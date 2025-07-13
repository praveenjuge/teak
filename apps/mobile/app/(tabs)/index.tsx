import { View, StyleSheet } from "react-native";
import { CardsGrid } from "../../components/CardsGrid";
import { SearchInput } from "../../components/SearchInput";
import { SearchProvider, useSearch } from "../../lib/SearchContext";
import { useDebouncedValue } from "../../lib/hooks";

function HomeContent() {
  const { searchQuery, selectedType } = useSearch();
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200);

  return (
    <>
      <SearchInput />
      <View style={styles.gridContainer}>
        <CardsGrid
          searchQuery={debouncedSearchQuery}
          selectedType={selectedType}
        />
      </View>
    </>
  );
}

export default function HomeScreen() {
  return (
    <SearchProvider>
      <HomeContent />
    </SearchProvider>
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    flex: 1,
  },
});
