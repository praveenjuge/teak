import { useState } from "react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { type CardType } from "../constants";
import { api } from "@teak/convex";

export interface SearchFiltersConfig {
  searchLimit?: number;
}

export function useSearchFilters(config: SearchFiltersConfig = {}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<CardType[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showTrashOnly, setShowTrashOnly] = useState(false);

  const searchTerms = [
    ...keywordTags,
    ...(searchQuery.trim() ? [searchQuery.trim()] : [])
  ].join(" ");

  const cards = useQuery(api.cards.searchCards, {
    searchQuery: searchTerms || undefined,
    types: filterTags.length > 0 ? filterTags : undefined,
    favoritesOnly: showFavoritesOnly || undefined,
    showTrashOnly: showTrashOnly || undefined,
    limit: config.searchLimit || 100,
  });

  const filteredCards = cards || [];

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();

      if (["fav", "favs", "favorites", "favourite", "favourites"].includes(query)) {
        toggleFavorites();
        setSearchQuery("");
        return;
      }

      if (["trash", "deleted", "bin", "recycle", "trashed"].includes(query)) {
        toggleTrash();
        setSearchQuery("");
        return;
      }

      if (!keywordTags.includes(query)) {
        setKeywordTags((prev) => [...prev, query]);
      }
      setSearchQuery("");
    } else if (
      e.key === "Backspace" &&
      searchQuery === "" &&
      (keywordTags.length > 0 || filterTags.length > 0 || showFavoritesOnly || showTrashOnly)
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

  const addFilter = (filter: CardType) => {
    if (!filterTags.includes(filter)) {
      setFilterTags((prev) => [...prev, filter]);
    }
  };

  const removeFilter = (filter: CardType) => {
    setFilterTags((prev) => prev.filter((tag) => tag !== filter));
  };

  const removeKeyword = (keyword: string) => {
    setKeywordTags((prev) => prev.filter((tag) => tag !== keyword));
  };

  const toggleFavorites = () => {
    setShowFavoritesOnly(!showFavoritesOnly);
    setShowTrashOnly(false);
  };

  const toggleTrash = () => {
    setShowTrashOnly(!showTrashOnly);
    setShowFavoritesOnly(false);
  };

  const clearAllFilters = () => {
    setSearchQuery("");
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
    filteredCards,
    cards,
    handleSearchChange,
    handleKeyDown,
    addFilter,
    removeFilter,
    removeKeyword,
    toggleFavorites,
    toggleTrash,
    clearAllFilters,
    setSearchQuery,
    setKeywordTags,
    setFilterTags,
    setShowFavoritesOnly,
    setShowTrashOnly,
  };
}