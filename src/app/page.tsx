"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useMutation } from "convex/react";
import { CardModal } from "@/components/CardModal";
import { SearchBar } from "@/components/SearchBar";
import { MasonryGrid } from "@/components/MasonryGrid";
import { AddCardForm } from "@/components/AddCardForm";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import { DragOverlay } from "@/components/DragOverlay";
import { CardsGridSkeleton } from "@/components/CardSkeleton";
import { useGlobalDragDrop } from "@/hooks/useGlobalDragDrop";
import { type Doc, type Id } from "@teak/convex/_generated/dataModel";
import { type CardType } from "@teak/convex/shared/constants";
import { useCardActions } from "@/hooks/useCardActions";
import { api } from "@teak/convex";
import { toast } from "sonner";
import { Authenticated, AuthLoading } from "convex/react";
import { metrics } from "@/lib/metrics";
import { TagManagementModal } from "@/components/TagManagementModal";

const DEFAULT_CARD_LIMIT = 100;

export default function HomePage() {
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [tagManagementCardId, setTagManagementCardId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<CardType[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showTrashOnly, setShowTrashOnly] = useState(false);

  const searchTerms = useMemo(
    () =>
      [
        ...keywordTags,
        ...(searchQuery.trim() ? [searchQuery.trim()] : []),
      ].join(" "),
    [keywordTags, searchQuery]
  );

  const queryArgs = useMemo(
    () => ({
      searchQuery: searchTerms || undefined,
      types: filterTags.length > 0 ? filterTags : undefined,
      favoritesOnly: showFavoritesOnly || undefined,
      showTrashOnly: showTrashOnly || undefined,
      limit: DEFAULT_CARD_LIMIT,
    }),
    [filterTags, searchTerms, showFavoritesOnly, showTrashOnly]
  );

  const cards = useQuery(api.cards.searchCards, queryArgs);

  const selectedCard = useMemo(
    () =>
      cards?.find((card: Doc<"cards">) => card._id === editingCardId) ?? null,
    [cards, editingCardId]
  );

  // Track search when results change and filters are active
  const hasActiveSearch =
    searchTerms || filterTags.length > 0 || showFavoritesOnly || showTrashOnly;
  useEffect(() => {
    if (cards !== undefined && hasActiveSearch) {
      metrics.searchPerformed(cards.length, filterTags);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards?.length, hasActiveSearch, filterTags]);

  const cardActions = useCardActions({
    onDeleteSuccess: (message) => message && toast(message),
    onRestoreSuccess: (message) => message && toast(message),
    onPermanentDeleteSuccess: (message) => message && toast(message),
    onError: (_error, operation) => {
      toast.error(`Failed to ${operation}`);
    },
  });

  const updateCardField = useMutation(api.cards.updateCardField);

  // Get the card for tag management
  const tagManagementCard = useMemo(
    () =>
      cards?.find((card: Doc<"cards">) => card._id === tagManagementCardId) ?? null,
    [cards, tagManagementCardId]
  );

  // Handler for opening tag management modal
  const handleAddTags = (cardId: string) => {
    setTagManagementCardId(cardId);
  };

  // Helper to convert blob to PNG
  const convertToPng = async (blob: Blob, fallbackWidth = 500, fallbackHeight = 500): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Don't set crossOrigin for blob URLs (they're same-origin)
      const blobUrl = URL.createObjectURL(blob);

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      img.onload = () => {
        // Use natural dimensions, fallback to current dimensions, then defaults
        const width = img.naturalWidth || img.width || fallbackWidth;
        const height = img.naturalHeight || img.height || fallbackHeight;
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(blobUrl);

        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("Failed to create PNG blob"));
        }, "image/png");
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(blobUrl);
        reject(err);
      };

      img.src = blobUrl;
    });
  };

  // Helper to get SVG dimensions from content
  const getSvgDimensions = (svgText: string): { width: number; height: number } => {
    // Try to extract viewBox (width, height from viewBox="x y w h")
    const viewBoxMatch = svgText.match(/viewBox=["']([^"']+)["']/);
    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].split(/\s+/);
      if (parts.length === 4) {
        return { width: Number(parts[2]), height: Number(parts[3]) };
      }
    }

    // Try to extract width and height attributes
    const widthMatch = svgText.match(/width=["'](\d+(?:\.\d+)?)["']/);
    const heightMatch = svgText.match(/height=["'](\d+(?:\.\d+)?)["']/);
    if (widthMatch && heightMatch) {
      return { width: Number(widthMatch[1]), height: Number(heightMatch[1]) };
    }

    // Default dimensions
    return { width: 500, height: 500 };
  };

  // Handler for copying to clipboard
  const handleCopyImage = async (content: string, isImage: boolean) => {
    if (isImage) {
      // Show loading toast immediately
      toast.loading("Copying image...", { id: "copy-image" });
    }

    try {
      if (isImage) {
        // Fetch the image in its original format
        const response = await fetch(content);
        const blob = await response.blob();

        // Try to copy in original format first
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ [blob.type]: blob })
          ]);
          toast.success("Image copied to clipboard", { id: "copy-image" });
          return;
        } catch (originalError) {
          // If original format isn't supported, try PNG as fallback
          if (
            originalError instanceof DOMException &&
            originalError.name === "NotAllowedError"
          ) {
            // Special handling for SVG - get dimensions from SVG content
            if (blob.type === "image/svg+xml") {
              const svgText = await blob.text();
              const { width, height } = getSvgDimensions(svgText);

              // Create a new blob with explicit dimensions
              const svgWithDimensions = svgText.replace(
                /<svg/,
                `<svg width="${width}" height="${height}"`
              );
              const sizedBlob = new Blob([svgWithDimensions], { type: "image/svg+xml" });

              try {
                const pngBlob = await convertToPng(sizedBlob, width, height);
                await navigator.clipboard.write([
                  new ClipboardItem({ "image/png": pngBlob })
                ]);
                toast.success("Image copied to clipboard", { id: "copy-image" });
                return;
              } catch {
                throw new Error("Failed to convert SVG to PNG");
              }
            }

            // For other formats
            const pngBlob = await convertToPng(blob);
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": pngBlob })
            ]);
            toast.success("Image copied to clipboard", { id: "copy-image" });
            return;
          }
          throw originalError;
        }
      } else {
        // For text/link, copy as text
        await navigator.clipboard.writeText(content);
        toast.success("Copied to clipboard");
      }
    } catch (error) {
      console.error("Failed to copy:", error);
      // Fallback: copy the URL instead
      try {
        await navigator.clipboard.writeText(content);
        toast.success("Link copied to clipboard", { id: "copy-image" });
      } catch {
        toast.error("Failed to copy to clipboard", { id: "copy-image" });
      }
    }
  };

  // Tag management handlers
  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    const currentTags = tagManagementCard?.tags || [];

    if (tag && !currentTags.includes(tag) && tagManagementCardId) {
      const newTags = [...currentTags, tag];
      void updateCardField({
        cardId: tagManagementCardId as Id<"cards">,
        field: "tags",
        value: newTags,
      });
      setTagInput("");
      metrics.tagAdded("user");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const currentTags = tagManagementCard?.tags || [];
    const newTags = currentTags.filter((tag: string) => tag !== tagToRemove);

    if (tagManagementCardId) {
      void updateCardField({
        cardId: tagManagementCardId as Id<"cards">,
        field: "tags",
        value: newTags.length > 0 ? newTags : undefined,
      });
      metrics.tagRemoved("user");
    }
  };

  const handleRemoveAiTag = (tagToRemove: string) => {
    if (tagManagementCardId) {
      void updateCardField({
        cardId: tagManagementCardId as Id<"cards">,
        field: "removeAiTag",
        tagToRemove,
      });
      metrics.tagRemoved("ai");
    }
  };

  const {
    getRootProps,
    getInputProps,
    dragDropState,
    dismissUpgradePrompt,
    navigateToUpgrade,
  } = useGlobalDragDrop();

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();

      if (
        ["fav", "favs", "favorites", "favourite", "favourites"].includes(query)
      ) {
        setShowFavoritesOnly(!showFavoritesOnly);
        setSearchQuery("");
        return;
      }

      if (["trash", "deleted", "bin", "recycle", "trashed"].includes(query)) {
        setShowTrashOnly(!showTrashOnly);
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

  const addFilter = (filter: CardType) => {
    if (!filterTags.includes(filter)) {
      metrics.filterApplied("type");
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
    if (!showFavoritesOnly) {
      metrics.filterApplied("favorites");
    }
    setShowFavoritesOnly(!showFavoritesOnly);
  };

  const toggleTrash = () => {
    if (!showTrashOnly) {
      metrics.filterApplied("trash");
    }
    setShowTrashOnly(!showTrashOnly);
  };

  const clearAllFilters = () => {
    setSearchQuery("");
    setKeywordTags([]);
    setFilterTags([]);
    setShowFavoritesOnly(false);
    setShowTrashOnly(false);
  };

  const handleCardClick = (card: Doc<"cards">) => {
    metrics.modalOpened("card");
    setEditingCardId(card._id);
  };

  const handleEditCancel = () => {
    setEditingCardId(null);
  };

  const handleCardTypeClick = (cardType: string) => {
    setEditingCardId(null);
    addFilter(cardType as CardType);
  };

  const handleTagClick = (tag: string) => {
    setEditingCardId(null);
    if (!keywordTags.includes(tag)) {
      setKeywordTags((prev) => [...prev, tag]);
    }
  };

  const hasNoFilters =
    keywordTags.length === 0 &&
    filterTags.length === 0 &&
    !showFavoritesOnly &&
    !showTrashOnly &&
    !searchQuery;

  const renderEmptyState = () => {
    if (cards === undefined || cards === null || !cards)
      return <CardsGridSkeleton />;

    if ((cards?.length || 0) === 0 && hasNoFilters) {
      return (
        <div className="text-center flex flex-col items-center max-w-xs mx-auto py-20 gap-5">
          <Logo variant="current" />
          <AddCardForm autoFocus />
          <div className="space-y-1">
            <h3 className="font-medium">Let&apos;s add your first card!</h3>
            <p className="text-muted-foreground text-balance">
              Start capturing your thoughts, links, and media above
            </p>
          </div>
        </div>
      );
    }

    if ((cards?.length || 0) === 0) {
      return (
        <div className="text-center py-12 space-y-4">
          <p className="text-muted-foreground">
            Nothing found matching your filters
          </p>
          <Button variant="outline" onClick={clearAllFilters}>
            Clear filters
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <div {...getRootProps()} className="relative">
      <input {...getInputProps()} />
      <SearchBar
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onKeyDown={handleKeyDown}
        keywordTags={keywordTags}
        filterTags={filterTags}
        showFavoritesOnly={showFavoritesOnly}
        showTrashOnly={showTrashOnly}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilter}
        onRemoveKeyword={removeKeyword}
        onToggleFavorites={toggleFavorites}
        onToggleTrash={toggleTrash}
        onClearAll={clearAllFilters}
      />

      {(cards?.length || 0) > 0 ? (
        <MasonryGrid
          filteredCards={cards}
          showTrashOnly={showTrashOnly}
          onCardClick={handleCardClick}
          onDeleteCard={(cardId) =>
            cardActions.handleDeleteCard(cardId as Id<"cards">)
          }
          onRestoreCard={(cardId) =>
            cardActions.handleRestoreCard(cardId as Id<"cards">)
          }
          onPermanentDeleteCard={(cardId) =>
            cardActions.handlePermanentDeleteCard(cardId as Id<"cards">)
          }
          onToggleFavorite={(cardId) =>
            cardActions.handleToggleFavorite(cardId as Id<"cards">)
          }
          onAddTags={handleAddTags}
          onCopyImage={handleCopyImage}
        />
      ) : (
        <>
          <AuthLoading>
            <CardsGridSkeleton />
          </AuthLoading>
          <Authenticated>{renderEmptyState()}</Authenticated>
        </>
      )}

      <CardModal
        cardId={editingCardId}
        card={selectedCard}
        open={!!editingCardId}
        onCancel={handleEditCancel}
        onCardTypeClick={handleCardTypeClick}
        onTagClick={handleTagClick}
      />

      <TagManagementModal
        open={!!tagManagementCardId}
        onOpenChange={(open) => !open && setTagManagementCardId(null)}
        userTags={tagManagementCard?.tags || []}
        aiTags={tagManagementCard?.aiTags || []}
        tagInput={tagInput}
        setTagInput={setTagInput}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
        onRemoveAiTag={handleRemoveAiTag}
      />

      <DragOverlay
        dragDropState={dragDropState}
        dismissUpgradePrompt={dismissUpgradePrompt}
        navigateToUpgrade={navigateToUpgrade}
      />
    </div>
  );
}
