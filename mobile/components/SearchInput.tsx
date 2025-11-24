import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { borderWidths, colors } from '@/constants/colors';

interface SearchInputProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedType?: string;
  setSelectedType: (type: string | undefined) => void;
}

export function SearchInput({ searchQuery, setSearchQuery }: SearchInputProps) {

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
        color={dynamicStyles.icon.color}
        name="magnifyingglass"
        size={20}
        style={styles.searchIcon}
      />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onChangeText={setSearchQuery}
        placeholder="Search cards..."
        returnKeyType="search"
        style={[styles.input, dynamicStyles.input]}
        value={searchQuery}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
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
