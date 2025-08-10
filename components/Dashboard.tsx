import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import { AddCardForm } from "./AddCardForm";
import { CardModal } from "./CardModal";
import { Card } from "./Card";
import {
  type CardData,
  type CardType,
  RESERVED_KEYWORDS,
  type TypeaheadOption,
} from "@/lib/types";
import { TagContainer } from "./SearchTags";
import { SearchTypeahead } from "./SearchTypeahead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

// Legacy shim removed after migration

export function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<CardType[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [editingCard, setEditingCard] = useState<CardData | null>(null);
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [typeaheadSelectedIndex, setTypeaheadSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const cards = useQuery(api.cards.getCards, {
    favoritesOnly: showFavoritesOnly,
  });

  const deleteCard = useMutation(api.cards.deleteCard);
  const toggleFavorite = useMutation(api.cards.toggleFavorite);

  const handleDeleteCard = async (cardId: string) => {
    if (confirm("Are you sure you want to delete this card?")) {
      try {
        await deleteCard({ id: cardId as Id<"cards"> });
      } catch (error) {
        console.error("Failed to delete card:", error);
      }
    }
  };

  const handleToggleFavorite = async (cardId: string) => {
    try {
      await toggleFavorite({ id: cardId as Id<"cards"> });
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  };

  const handleCardClick = (card: CardData) => {
    setEditingCard(card);
  };

  const handleEditCancel = () => {
    setEditingCard(null);
  };

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
          setTypeaheadSelectedIndex((prev) => prev > 0 ? prev - 1 : prev);
          return;
        case "Enter":
          e.preventDefault();
          if (filteredOptions[typeaheadSelectedIndex]) {
            const selectedOption = filteredOptions[typeaheadSelectedIndex];
            if (selectedOption.value === "favorites") {
              setShowFavoritesOnly(true);
            } else if (!filterTags.includes(selectedOption.value as CardType)) {
              setFilterTags((
                prev,
              ) => [...prev, selectedOption.value as CardType]);
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

      // Check if it's a favorites keyword
      if (
        ["fav", "favs", "favorites", "favourite", "favourites"].includes(query)
      ) {
        setShowFavoritesOnly(true);
        setSearchQuery("");
        return;
      }

      // Only add as keyword if typeahead is not showing or has no matches
      if (!showTypeahead || filteredOptions.length === 0) {
        if (!keywordTags.includes(query)) {
          setKeywordTags((prev) => [...prev, query]);
        }
        setSearchQuery("");
      }
    } else if (
      e.key === "Backspace" && searchQuery === "" &&
      (keywordTags.length > 0 || filterTags.length > 0 || showFavoritesOnly)
    ) {
      // Remove last tag when backspacing on empty input
      if (showFavoritesOnly) {
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

    // Show typeahead if typing reserved keyword
    const filteredOptions = getFilteredTypeaheadOptions();
    const hasMatch = filteredOptions.length > 0 && value.length > 0;
    setShowTypeahead(hasMatch);
    setTypeaheadSelectedIndex(0);
  };

  const handleTypeaheadSelect = (option: TypeaheadOption) => {
    if (option.value === "favorites") {
      setShowFavoritesOnly(true);
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

  const handleClearAllTags = () => {
    setKeywordTags([]);
    setFilterTags([]);
    setShowFavoritesOnly(false);
  };

  const filteredCards = cards?.filter((card) => {
    // Filter by keyword tags (OR logic - match any keyword)
    if (keywordTags.length > 0) {
      const hasKeywordMatch = keywordTags.some((keyword) =>
        card.title?.toLowerCase().includes(keyword) ||
        card.content.toLowerCase().includes(keyword) ||
        card.notes?.toLowerCase().includes(keyword) ||
        card.tags?.some((tag) => tag.toLowerCase().includes(keyword))
      );
      if (!hasKeywordMatch) return false;
    }

    // Filter by filter tags (must match at least one filter type)
    if (filterTags.length > 0) {
      if (!filterTags.includes(card.type)) return false;
    }

    // Also include current search query for real-time filtering
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      // Check if it's a favorites search
      if (
        ["fav", "favs", "favorites", "favourite", "favourites"].includes(query)
      ) {
        return card.isFavorited === true;
      }
      return (
        card.title?.toLowerCase().includes(query) ||
        card.content.toLowerCase().includes(query) ||
        card.notes?.toLowerCase().includes(query) ||
        card.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    return true;
  }) || [];

  return (
    <div>
      {/* Filters and Search */}
      {/* Search and User */}
      <div className="flex items-center gap-4 h-14">
        <div className="relative flex-1 h-full">
          <Search className="absolute left-0 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4 select-auto pointer-events-none" />
          <Input
            ref={inputRef}
            type="search"
            placeholder="Search for anything..."
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            className="pl-7 rounded-none border-0 w-full focus-visible:outline-none focus-visible:ring-0 h-full"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <SearchTypeahead
            searchValue={searchQuery}
            isVisible={showTypeahead}
            onSelect={handleTypeaheadSelect}
            onClose={() => {
              setShowTypeahead(false);
              setTypeaheadSelectedIndex(0);
            }}
            inputRef={inputRef}
            selectedIndex={typeaheadSelectedIndex}
            setSelectedIndex={setTypeaheadSelectedIndex}
          />
        </div>
        <UserButton />
      </div>

      {/* Tag Container */}
      <TagContainer
        keywordTags={keywordTags}
        filterTags={filterTags}
        showFavoritesOnly={showFavoritesOnly}
        onRemoveKeyword={handleRemoveKeyword}
        onRemoveFilter={handleRemoveFilter}
        onRemoveFavorites={handleRemoveFavorites}
        onClearAll={handleClearAllTags}
      />

      {/* Cards Display */}
      {filteredCards.length === 0 && keywordTags.length === 0 &&
          filterTags.length === 0 && !showFavoritesOnly && !searchQuery
        ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Add Card Form as first item in grid */}
            <AddCardForm />

            <div className="text-center py-12 col-span-full">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No content yet
                </h3>
                <p className="text-muted-foreground mb-4">
                  Start capturing your thoughts, links, and media using the form
                  above
                </p>
              </div>
            </div>
          </div>
        )
        : filteredCards.length === 0
        ? (
          <div className="text-center py-12">
            {cards === undefined
              ? <p className="text-muted-foreground">Loading your content...</p>
              : (
                <div>
                  <p className="text-muted-foreground mb-2">
                    No content found matching your filters
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery("");
                      setKeywordTags([]);
                      setFilterTags([]);
                      setShowFavoritesOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
          </div>
        )
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Add Card Form as first item in grid */}
            <AddCardForm />

            {filteredCards.map((card) => (
              <Card
                key={card._id}
                card={card}
                onClick={handleCardClick}
                onDelete={handleDeleteCard}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        )}

      {/* Card Modal */}
      <CardModal
        card={editingCard}
        open={!!editingCard}
        onCancel={handleEditCancel}
        onDelete={handleDeleteCard}
        onToggleFavorite={handleToggleFavorite}
      />
    </div>
  );
}
