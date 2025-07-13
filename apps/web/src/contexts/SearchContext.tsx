import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import type { Card } from '@/lib/api';

interface SearchContextType {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedType: Card['type'] | undefined;
  setSelectedType: (type: Card['type'] | undefined) => void;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<Card['type'] | undefined>();

  return (
    <SearchContext.Provider
      value={{
        searchQuery,
        setSearchQuery,
        selectedType,
        setSelectedType,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}
