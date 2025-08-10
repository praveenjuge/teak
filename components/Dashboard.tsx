import { useMemo, useRef, useState } from "react";
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
import { Masonry } from "react-plock";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { toast } from "sonner";

// Legacy shim removed after migration

export function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<CardType[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showTrashOnly, setShowTrashOnly] = useState(false);
  const [editingCard, setEditingCard] = useState<CardData | null>(null);
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [typeaheadSelectedIndex, setTypeaheadSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const deletedCards = useQuery(api.cards.getDeletedCards, showTrashOnly ? {} : "skip");
  const regularCards = useQuery(
    api.cards.getCards, 
    showTrashOnly ? "skip" : { favoritesOnly: showFavoritesOnly }
  );
  
  const cards = showTrashOnly ? deletedCards : regularCards;

  const deleteCard = useMutation(api.cards.deleteCard);
  const restoreCard = useMutation(api.cards.restoreCard);
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const toggleFavorite = useMutation(api.cards.toggleFavorite);

  const handleDeleteCard = async (cardId: string) => {
    try {
      await deleteCard({ id: cardId as Id<"cards"> });
      toast("Card deleted. Find it by searching 'trash'");
    } catch (error) {
      console.error("Failed to delete card:", error);
      toast.error("Failed to delete card");
    }
  };

  const handleRestoreCard = async (cardId: string) => {
    try {
      await restoreCard({ id: cardId as Id<"cards"> });
      toast("Card restored");
    } catch (error) {
      console.error("Failed to restore card:", error);
      toast.error("Failed to restore card");
    }
  };

  const handlePermanentDeleteCard = async (cardId: string) => {
    try {
      await permanentDeleteCard({ id: cardId as Id<"cards"> });
      toast("Card permanently deleted");
    } catch (error) {
      console.error("Failed to permanently delete card:", error);
      toast.error("Failed to permanently delete card");
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
              setShowTrashOnly(false);
            } else if (selectedOption.value === "trash") {
              setShowTrashOnly(true);
              setShowFavoritesOnly(false);
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
        setShowTrashOnly(false);
        setSearchQuery("");
        return;
      }

      // Check if it's a trash keyword
      if (
        ["trash", "deleted", "bin", "recycle", "trashed"].includes(query)
      ) {
        setShowTrashOnly(true);
        setShowFavoritesOnly(false);
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
      (keywordTags.length > 0 || filterTags.length > 0 || showFavoritesOnly ||
        showTrashOnly)
    ) {
      // Remove last tag when backspacing on empty input
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

    // Show typeahead if typing reserved keyword
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
    return cards?.filter((card) => {
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
          ["fav", "favs", "favorites", "favourite", "favourites"].includes(
            query,
          )
        ) {
          return card.isFavorited === true;
        }
        // Check if it's a trash search
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
    }) || [];
  }, [cards, keywordTags, filterTags, searchQuery]);

  // Create masonry items combining AddCardForm and filtered cards
  const masonryItems = useMemo(() => {
    const items: Array<
      { type: "addForm" | "card"; data?: CardData; id: string }
    > = [];

    // Only include the AddCardForm when not in trash mode
    if (!showTrashOnly) {
      items.push({ type: "addForm", id: "add-form" });
    }

    // Add filtered cards
    filteredCards.forEach((card) => {
      items.push({ type: "card", data: card, id: card._id });
    });

    return items;
  }, [filteredCards, showTrashOnly]);

  // Masonry render function for react-plock
  const renderMasonryItem = (item: typeof masonryItems[0], index: number) => {
    if (item.type === "addForm") {
      return <AddCardForm key={item.id} />;
    }

    if (item.type === "card" && item.data) {
      return (
        <Card
          key={item.data._id}
          card={item.data}
          onClick={handleCardClick}
          onDelete={handleDeleteCard}
          onRestore={handleRestoreCard}
          onPermanentDelete={handlePermanentDeleteCard}
          onToggleFavorite={handleToggleFavorite}
          isTrashMode={showTrashOnly}
        />
      );
    }

    return null;
  };

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
        showTrashOnly={showTrashOnly}
        onRemoveKeyword={handleRemoveKeyword}
        onRemoveFilter={handleRemoveFilter}
        onRemoveFavorites={handleRemoveFavorites}
        onRemoveTrash={handleRemoveTrash}
        onClearAll={handleClearAllTags}
      />

      {/* Cards Display */}
      {filteredCards.length === 0 && keywordTags.length === 0 &&
          filterTags.length === 0 && !showFavoritesOnly && !showTrashOnly &&
          !searchQuery
        ? (
          <div>
            <Masonry
              items={[{ type: "addForm" as const, id: "add-form" }]}
              config={{
                columns: [1, 2, 5],
                gap: [16, 16, 16],
                media: [640, 768, 1024],
              }}
              render={renderMasonryItem}
            />
            <div className="text-center py-12">
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
                      setShowTrashOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
          </div>
        )
        : (
          <Masonry
            items={masonryItems}
            config={{
              columns: [1, 2, 5],
              gap: [16, 16, 16],
              media: [640, 768, 1024],
            }}
            render={renderMasonryItem}
          />
        )}

      {/* Card Modal */}
      <CardModal
        card={editingCard}
        open={!!editingCard}
        onCancel={handleEditCancel}
        onDelete={handleDeleteCard}
        onRestore={handleRestoreCard}
        onPermanentDelete={handlePermanentDeleteCard}
        onToggleFavorite={handleToggleFavorite}
        isTrashMode={showTrashOnly}
      />
    </div>
  );
}
