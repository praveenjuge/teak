import { useState } from "react";
import { useQuery } from "convex/react";
import {
  type CardType,
  RESERVED_KEYWORDS,
  type TypeaheadOption,
} from "../constants";
import { api } from "@teak/convex";

export interface SearchFiltersConfig {
  // Optional callback when suggestions are needed
  onTypeaheadUpdate?: (options: TypeaheadOption[], selectedIndex: number) => void;
  // For custom search behavior
  customSearchEnabled?: boolean;
  // Limit for search results
  searchLimit?: number;
}

export function useSearchFilters(config: SearchFiltersConfig = {}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<CardType[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showTrashOnly, setShowTrashOnly] = useState(false);
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [typeaheadSelectedIndex, setTypeaheadSelectedIndex] = useState(0);

  // Build search query for server-side filtering
  const searchTerms = [
    ...keywordTags,
    ...(searchQuery.trim() ? [searchQuery.trim()] : [])
  ].join(" ");

  // Use server-side search query
  const cards = useQuery(api.cards.searchCards, {
    searchQuery: searchTerms || undefined,
    types: filterTags.length > 0 ? filterTags : undefined,
    favoritesOnly: showFavoritesOnly || undefined,
    showTrashOnly: showTrashOnly || undefined,
    limit: config.searchLimit || 100,
  });

  // Server handles all filtering, so filteredCards is just cards
  const filteredCards = cards || [];

  const getFilteredTypeaheadOptions = () => {
    return RESERVED_KEYWORDS.filter((option) =>
      option.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const filteredOptions = getFilteredTypeaheadOptions();

    if (showTypeahead && filteredOptions.length > 0) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          const newDownIndex = typeaheadSelectedIndex < filteredOptions.length - 1 ? typeaheadSelectedIndex + 1 : typeaheadSelectedIndex;
          setTypeaheadSelectedIndex(newDownIndex);
          config.onTypeaheadUpdate?.(filteredOptions, newDownIndex);
          return;
        case "ArrowUp":
          e.preventDefault();
          const newUpIndex = typeaheadSelectedIndex > 0 ? typeaheadSelectedIndex - 1 : typeaheadSelectedIndex;
          setTypeaheadSelectedIndex(newUpIndex);
          config.onTypeaheadUpdate?.(filteredOptions, newUpIndex);
          return;
        case "Enter":
          e.preventDefault();
          if (filteredOptions[typeaheadSelectedIndex]) {
            const selectedOption = filteredOptions[typeaheadSelectedIndex];
            handleTypeaheadSelect(selectedOption);
          }
          return;
        case "Escape":
          setShowTypeahead(false);
          setTypeaheadSelectedIndex(0);
          config.onTypeaheadUpdate?.([], 0);
          return;
      }
    }

    if (e.key === "Enter" && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();

      if (
        ["fav", "favs", "favorites", "favourite", "favourites"].includes(query)
      ) {
        setShowFavoritesOnly(true);
        setShowTrashOnly(false);
        setSearchQuery("");
        return;
      }

      if (["trash", "deleted", "bin", "recycle", "trashed"].includes(query)) {
        setShowTrashOnly(true);
        setShowFavoritesOnly(false);
        setSearchQuery("");
        return;
      }

      if (!showTypeahead || filteredOptions.length === 0) {
        if (!keywordTags.includes(query)) {
          setKeywordTags((prev) => [...prev, query]);
        }
        setSearchQuery("");
      }
    } else if (
      e.key === "Backspace" &&
      searchQuery === "" &&
      (keywordTags.length > 0 ||
        filterTags.length > 0 ||
        showFavoritesOnly ||
        showTrashOnly)
    ) {
      if (showTrashOnly) {
        setShowTrashOnly(false);
      } else if (showFavoritesOnly) {
        setShowFavoritesOnly(false);
      } else if (filterTags.length > 0) {
        setFilterTags((prev) => prev.slice(0, -1));
      } else if (keywordTags.length > 0) {
        setKeywordTags((prev) => prev.slice(0, -1));
      }
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    const filteredOptions = getFilteredTypeaheadOptions();
    const hasMatch = filteredOptions.length > 0 && value.length > 0;
    setShowTypeahead(hasMatch);
    setTypeaheadSelectedIndex(0);

    if (hasMatch) {
      config.onTypeaheadUpdate?.(filteredOptions, 0);
    } else {
      config.onTypeaheadUpdate?.([], 0);
    }
  };

  const handleTypeaheadSelect = (option: TypeaheadOption) => {
    if (option.value === "favorites") {
      setShowFavoritesOnly(!showFavoritesOnly); // Toggle favorites
    } else if (option.value === "trash") {
      setShowTrashOnly(!showTrashOnly); // Toggle trash
    } else if (!filterTags.includes(option.value as CardType)) {
      setFilterTags((prev) => [...prev, option.value as CardType]);
    }
    setSearchQuery("");
    setShowTypeahead(false);
    setTypeaheadSelectedIndex(0);
    config.onTypeaheadUpdate?.([], 0);
  };

  const handleRemoveKeyword = (keyword: string) => {
    setKeywordTags((prev) => prev.filter((tag) => tag !== keyword));
  };

  const handleRemoveFilter = (filter: CardType) => {
    setFilterTags((prev) => prev.filter((tag) => tag !== filter));
  };

  const handleRemoveFavorites = () => {
    setShowFavoritesOnly(false);
  };

  const handleRemoveTrash = () => {
    setShowTrashOnly(false);
  };

  const handleClearAllTags = () => {
    setKeywordTags([]);
    setFilterTags([]);
    setShowFavoritesOnly(false);
    setShowTrashOnly(false);
  };

  return {
    searchQuery,
    keywordTags,
    filterTags,
    showFavoritesOnly,
    showTrashOnly,
    showTypeahead,
    typeaheadSelectedIndex,
    filteredCards,
    cards,
    handleKeyDown,
    handleSearchChange,
    handleTypeaheadSelect,
    handleRemoveKeyword,
    handleRemoveFilter,
    handleRemoveFavorites,
    handleRemoveTrash,
    handleClearAllTags,
    setTypeaheadSelectedIndex,
    setShowTypeahead,
    setSearchQuery,
    setKeywordTags,
    setFilterTags,
    setShowFavoritesOnly,
    setShowTrashOnly,
    getFilteredTypeaheadOptions,
  };
}