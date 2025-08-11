import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  type CardType,
  RESERVED_KEYWORDS,
  type TypeaheadOption,
} from "@/lib/constants";
import { api } from "../convex/_generated/api";

export function useSearchFilters() {
  const [searchQuery, setSearchQuery] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<CardType[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showTrashOnly, setShowTrashOnly] = useState(false);
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [typeaheadSelectedIndex, setTypeaheadSelectedIndex] = useState(0);

  const deletedCards = useQuery(
    api.cards.getDeletedCards,
    showTrashOnly ? {} : "skip"
  );
  const regularCards = useQuery(
    api.cards.getCards,
    showTrashOnly ? "skip" : { favoritesOnly: showFavoritesOnly }
  );

  const cards = showTrashOnly ? deletedCards : regularCards;

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
          setTypeaheadSelectedIndex((prev) =>
            prev < filteredOptions.length - 1 ? prev + 1 : prev
          );
          return;
        case "ArrowUp":
          e.preventDefault();
          setTypeaheadSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          return;
        case "Enter":
          e.preventDefault();
          if (filteredOptions[typeaheadSelectedIndex]) {
            const selectedOption = filteredOptions[typeaheadSelectedIndex];
            if (selectedOption.value === "favorites") {
              setShowFavoritesOnly(true);
              setShowTrashOnly(false);
            } else if (selectedOption.value === "trash") {
              setShowTrashOnly(true);
              setShowFavoritesOnly(false);
            } else if (!filterTags.includes(selectedOption.value as CardType)) {
              setFilterTags((prev) => [
                ...prev,
                selectedOption.value as CardType,
              ]);
            }
            setSearchQuery("");
            setShowTypeahead(false);
            setTypeaheadSelectedIndex(0);
          }
          return;
        case "Escape":
          setShowTypeahead(false);
          setTypeaheadSelectedIndex(0);
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
  };

  const handleTypeaheadSelect = (option: TypeaheadOption) => {
    if (option.value === "favorites") {
      setShowFavoritesOnly(true);
      setShowTrashOnly(false);
    } else if (option.value === "trash") {
      setShowTrashOnly(true);
      setShowFavoritesOnly(false);
    } else if (!filterTags.includes(option.value as CardType)) {
      setFilterTags((prev) => [...prev, option.value as CardType]);
    }
    setSearchQuery("");
    setShowTypeahead(false);
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

  const filteredCards = useMemo(() => {
    return (
      cards?.filter((card) => {
        if (keywordTags.length > 0) {
          const hasKeywordMatch = keywordTags.some(
            (keyword) =>
              card.title?.toLowerCase().includes(keyword) ||
              card.content.toLowerCase().includes(keyword) ||
              card.notes?.toLowerCase().includes(keyword) ||
              card.tags?.some((tag) => tag.toLowerCase().includes(keyword))
          );
          if (!hasKeywordMatch) return false;
        }

        if (filterTags.length > 0) {
          if (!filterTags.includes(card.type)) return false;
        }

        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          if (
            ["fav", "favs", "favorites", "favourite", "favourites"].includes(
              query
            )
          ) {
            return card.isFavorited === true;
          }
          if (
            ["trash", "deleted", "bin", "recycle", "trashed"].includes(query)
          ) {
            return card.isDeleted === true;
          }
          return (
            card.title?.toLowerCase().includes(query) ||
            card.content.toLowerCase().includes(query) ||
            card.notes?.toLowerCase().includes(query) ||
            card.tags?.some((tag) => tag.toLowerCase().includes(query))
          );
        }

        return true;
      }) || []
    );
  }, [cards, keywordTags, filterTags, searchQuery]);

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
  };
}
