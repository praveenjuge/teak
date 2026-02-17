"use client";

import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  normalizeColorHueBucket,
  normalizeHexColor,
  normalizeVisualStyle,
  parseTimeSearchQuery,
  type TimeFilter,
} from "@teak/convex/shared";
import type {
  CardType,
  ColorHueBucket,
  VisualStyle,
} from "@teak/convex/shared/constants";
import type { CardWithUrls } from "@teak/ui/cards";
import { Button } from "@teak/ui/components/ui/button";
import { CardsGridSkeleton } from "@teak/ui/feedback/CardsGridSkeleton";
import Logo from "@teak/ui/logo";
import { Authenticated, AuthLoading, useMutation } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react/cache/hooks";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AddCardForm } from "@/components/AddCardForm";
import { CardModal } from "@/components/CardModal";
import { DragOverlay } from "@/components/DragOverlay";
import { MasonryGrid } from "@/components/MasonryGrid";
import { SearchBar } from "@/components/SearchBar";
import { TagManagementModal } from "@/components/TagManagementModal";
import { useCardActions } from "@/hooks/useCardActions";
import { useGlobalDragDrop } from "@/hooks/useGlobalDragDrop";
import { filterLocalCards } from "@/lib/localSearch";
import { metrics } from "@/lib/metrics";

const DEFAULT_CARD_LIMIT = 100;
const LOCAL_SEARCH_CACHE_LIMIT = 1000;
const SEARCH_TOKEN_SEPARATOR = /\s+/;
const SEARCH_TOKEN_TRIM_PATTERN = /^[,.;:!?()[\]{}"']+|[,.;:!?()[\]{}"']+$/g;

export default function HomePage() {
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [tagManagementCardId, setTagManagementCardId] = useState<string | null>(
    null
  );
  const [tagInput, setTagInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<CardType[]>([]);
  const [styleFilters, setStyleFilters] = useState<VisualStyle[]>([]);
  const [hueFilters, setHueFilters] = useState<ColorHueBucket[]>([]);
  const [hexFilters, setHexFilters] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showTrashOnly, setShowTrashOnly] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter | null>(null);
  const [localCards, setLocalCards] = useState<Doc<"cards">[]>([]);

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
      styleFilters: styleFilters.length > 0 ? styleFilters : undefined,
      hueFilters: hueFilters.length > 0 ? hueFilters : undefined,
      hexFilters: hexFilters.length > 0 ? hexFilters : undefined,
      createdAtRange: timeFilter?.range,
    }),
    [
      filterTags,
      hexFilters,
      hueFilters,
      searchTerms,
      showFavoritesOnly,
      showTrashOnly,
      styleFilters,
      timeFilter,
    ]
  );

  const {
    results: cards,
    status: cardsStatus,
    loadMore,
  } = usePaginatedQuery(api.cards.searchCardsPaginated, queryArgs, {
    initialNumItems: DEFAULT_CARD_LIMIT,
  });

  useEffect(() => {
    if (!cards || cards.length === 0) {
      return;
    }

    setLocalCards((prev) => {
      const map = new Map(prev.map((card) => [card._id, card]));
      let changed = false;

      for (const card of cards) {
        const existing = map.get(card._id);
        if (!existing || existing.updatedAt !== card.updatedAt) {
          map.set(card._id, card);
          changed = true;
        }
      }

      if (!changed) {
        return prev;
      }

      const merged = Array.from(map.values());
      if (merged.length <= LOCAL_SEARCH_CACHE_LIMIT) {
        return merged;
      }

      return merged
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, LOCAL_SEARCH_CACHE_LIMIT);
    });
  }, [cards]);

  // Track search when results change and filters are active
  const hasActiveSearch =
    searchTerms ||
    filterTags.length > 0 ||
    styleFilters.length > 0 ||
    hueFilters.length > 0 ||
    hexFilters.length > 0 ||
    showFavoritesOnly ||
    showTrashOnly ||
    Boolean(timeFilter);

  const localSearchResults = useMemo(() => {
    if (!hasActiveSearch) {
      return [];
    }
    return filterLocalCards(localCards, {
      searchTerms,
      types: filterTags,
      styleFilters,
      hueFilters,
      hexFilters,
      favoritesOnly: showFavoritesOnly,
      showTrashOnly,
      createdAtRange: timeFilter?.range,
    });
  }, [
    filterTags,
    hexFilters,
    hasActiveSearch,
    hueFilters,
    localCards,
    searchTerms,
    showFavoritesOnly,
    showTrashOnly,
    styleFilters,
    timeFilter,
  ]);

  const displayCards = useMemo(() => {
    if (!hasActiveSearch) {
      return cards ?? [];
    }

    if (!cards || cards.length === 0) {
      return localSearchResults;
    }

    if (localSearchResults.length === 0) {
      return cards;
    }

    const localIds = new Set(localSearchResults.map((card) => card._id));
    const merged = [...localSearchResults];

    for (const card of cards) {
      if (!localIds.has(card._id)) {
        merged.push(card);
      }
    }

    return merged;
  }, [cards, hasActiveSearch, localSearchResults]);

  const selectedCard = useMemo(
    () =>
      displayCards.find((card: Doc<"cards">) => card._id === editingCardId) ??
      null,
    [displayCards, editingCardId]
  );
  useEffect(() => {
    if (hasActiveSearch && cardsStatus !== "LoadingFirstPage") {
      metrics.searchPerformed(cards.length, filterTags);
    }
  }, [cards.length, cardsStatus, hasActiveSearch, filterTags]);

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
      displayCards.find(
        (card: Doc<"cards">) => card._id === tagManagementCardId
      ) ?? null,
    [displayCards, tagManagementCardId]
  );

  // Handler for opening tag management modal
  const handleAddTags = (cardId: string) => {
    setTagManagementCardId(cardId);
  };

  // Helper to convert blob to PNG
  const convertToPng = async (
    blob: Blob,
    fallbackWidth = 500,
    fallbackHeight = 500
  ): Promise<Blob> => {
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
          if (b) {
            resolve(b);
          } else {
            reject(new Error("Failed to create PNG blob"));
          }
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
  const getSvgDimensions = (
    svgText: string
  ): { width: number; height: number } => {
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
            new ClipboardItem({ [blob.type]: blob }),
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
              const sizedBlob = new Blob([svgWithDimensions], {
                type: "image/svg+xml",
              });

              try {
                const pngBlob = await convertToPng(sizedBlob, width, height);
                await navigator.clipboard.write([
                  new ClipboardItem({ "image/png": pngBlob }),
                ]);
                toast.success("Image copied to clipboard", {
                  id: "copy-image",
                });
                return;
              } catch {
                throw new Error("Failed to convert SVG to PNG");
              }
            }

            // For other formats
            const pngBlob = await convertToPng(blob);
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": pngBlob }),
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

  const { getRootProps, getInputProps, isDragActive } = useGlobalDragDrop();

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      const parsedTime = parseTimeSearchQuery(searchQuery, {
        now: new Date(),
        weekStart: 0,
      });

      if (parsedTime) {
        setTimeFilter(parsedTime);
        setSearchQuery("");
        return;
      }

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

      const styleAdditions: VisualStyle[] = [];
      const hueAdditions: ColorHueBucket[] = [];
      const hexAdditions: string[] = [];
      const keywordAdditions: string[] = [];

      for (const token of searchQuery.split(SEARCH_TOKEN_SEPARATOR)) {
        const normalizedToken = token.replace(SEARCH_TOKEN_TRIM_PATTERN, "");
        if (!normalizedToken) {
          continue;
        }

        const styleFilter = normalizeVisualStyle(normalizedToken);
        if (styleFilter) {
          if (
            !(
              styleFilters.includes(styleFilter) ||
              styleAdditions.includes(styleFilter)
            )
          ) {
            styleAdditions.push(styleFilter);
            metrics.filterApplied("style");
          }
          continue;
        }

        const hueFilter = normalizeColorHueBucket(normalizedToken);
        if (hueFilter) {
          if (
            !(
              hueFilters.includes(hueFilter) || hueAdditions.includes(hueFilter)
            )
          ) {
            hueAdditions.push(hueFilter);
            metrics.filterApplied("color");
          }
          continue;
        }

        const hexFilter = normalizeHexColor(normalizedToken);
        if (hexFilter) {
          if (
            !(
              hexFilters.includes(hexFilter) || hexAdditions.includes(hexFilter)
            )
          ) {
            hexAdditions.push(hexFilter);
            metrics.filterApplied("color");
          }
          continue;
        }

        const keyword = normalizedToken.toLowerCase();
        if (
          !(keywordTags.includes(keyword) || keywordAdditions.includes(keyword))
        ) {
          keywordAdditions.push(keyword);
          metrics.filterApplied("keyword");
        }
      }

      if (styleAdditions.length > 0) {
        setStyleFilters((prev) => [...prev, ...styleAdditions]);
      }
      if (hueAdditions.length > 0) {
        setHueFilters((prev) => [...prev, ...hueAdditions]);
      }
      if (hexAdditions.length > 0) {
        setHexFilters((prev) => [...prev, ...hexAdditions]);
      }
      if (keywordAdditions.length > 0) {
        setKeywordTags((prev) => [...prev, ...keywordAdditions]);
      }
      setSearchQuery("");
    } else if (
      e.key === "Backspace" &&
      searchQuery === "" &&
      (keywordTags.length > 0 ||
        filterTags.length > 0 ||
        styleFilters.length > 0 ||
        hueFilters.length > 0 ||
        hexFilters.length > 0 ||
        showFavoritesOnly ||
        showTrashOnly ||
        timeFilter)
    ) {
      if (hexFilters.length > 0) {
        setHexFilters((prev) => prev.slice(0, -1));
      } else if (hueFilters.length > 0) {
        setHueFilters((prev) => prev.slice(0, -1));
      } else if (styleFilters.length > 0) {
        setStyleFilters((prev) => prev.slice(0, -1));
      } else if (showTrashOnly) {
        setShowTrashOnly(false);
      } else if (showFavoritesOnly) {
        setShowFavoritesOnly(false);
      } else if (filterTags.length > 0) {
        setFilterTags((prev) => prev.slice(0, -1));
      } else if (timeFilter) {
        setTimeFilter(null);
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

  const removeStyleFilter = (style: VisualStyle) => {
    setStyleFilters((prev) =>
      prev.filter((activeStyle) => activeStyle !== style)
    );
  };

  const removeHueFilter = (hue: ColorHueBucket) => {
    setHueFilters((prev) => prev.filter((activeHue) => activeHue !== hue));
  };

  const removeHexFilter = (hex: string) => {
    const normalizedHex = normalizeHexColor(hex);
    if (!normalizedHex) {
      return;
    }
    setHexFilters((prev) =>
      prev.filter((activeHex) => activeHex !== normalizedHex)
    );
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
    setStyleFilters([]);
    setHueFilters([]);
    setHexFilters([]);
    setShowFavoritesOnly(false);
    setShowTrashOnly(false);
    setTimeFilter(null);
  };

  const handleCardClick = (card: CardWithUrls & Record<string, unknown>) => {
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
    styleFilters.length === 0 &&
    hueFilters.length === 0 &&
    hexFilters.length === 0 &&
    !showFavoritesOnly &&
    !showTrashOnly &&
    !searchQuery &&
    !timeFilter;

  const renderEmptyState = () => {
    if (cardsStatus === "LoadingFirstPage") {
      return <CardsGridSkeleton />;
    }

    if (displayCards.length === 0 && hasNoFilters) {
      return (
        <div className="mx-auto flex max-w-xs flex-col items-center gap-5 py-20 text-center">
          <Logo variant="current" />
          <AddCardForm autoFocus />
          <div className="space-y-1">
            <h3 className="font-medium">Let&apos;s add your first card!</h3>
            <p className="text-balance text-muted-foreground">
              Start capturing your thoughts, links, and media above
            </p>
          </div>
        </div>
      );
    }

    if (displayCards.length === 0) {
      return (
        <div className="space-y-4 py-12 text-center">
          <p className="text-muted-foreground">
            Nothing found matching your filters
          </p>
          <Button onClick={clearAllFilters} variant="outline">
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
        filterTags={filterTags}
        hexFilters={hexFilters}
        hueFilters={hueFilters}
        keywordTags={keywordTags}
        onAddFilter={addFilter}
        onClearAll={clearAllFilters}
        onKeyDown={handleKeyDown}
        onRemoveFilter={removeFilter}
        onRemoveHexFilter={removeHexFilter}
        onRemoveHueFilter={removeHueFilter}
        onRemoveKeyword={removeKeyword}
        onRemoveStyleFilter={removeStyleFilter}
        onRemoveTimeFilter={() => setTimeFilter(null)}
        onSearchChange={handleSearchChange}
        onToggleFavorites={toggleFavorites}
        onToggleTrash={toggleTrash}
        searchQuery={searchQuery}
        showFavoritesOnly={showFavoritesOnly}
        showTrashOnly={showTrashOnly}
        styleFilters={styleFilters}
        timeFilter={timeFilter}
      />

      {displayCards.length > 0 ? (
        <MasonryGrid
          batchSize={DEFAULT_CARD_LIMIT}
          filteredCards={displayCards}
          hasMore={
            cardsStatus === "CanLoadMore" || cardsStatus === "LoadingMore"
          }
          initialBatchSize={DEFAULT_CARD_LIMIT}
          isLoadingMore={cardsStatus === "LoadingMore"}
          onAddTags={handleAddTags}
          onBulkDeleteCards={async (cardIds) => {
            const result = await cardActions.handleBulkDeleteCards(
              cardIds as Id<"cards">[]
            );
            return {
              ...result,
              failedIds: result.failedIds as string[],
            };
          }}
          onCardClick={handleCardClick}
          onCopyImage={handleCopyImage}
          onDeleteCard={async (cardId) =>
            cardActions.handleDeleteCard(cardId as Id<"cards">)
          }
          onLoadMore={() => loadMore(DEFAULT_CARD_LIMIT)}
          onPermanentDeleteCard={(cardId) =>
            cardActions.handlePermanentDeleteCard(cardId as Id<"cards">)
          }
          onRestoreCard={(cardId) =>
            cardActions.handleRestoreCard(cardId as Id<"cards">)
          }
          onToggleFavorite={(cardId) =>
            cardActions.handleToggleFavorite(cardId as Id<"cards">)
          }
          resetKey={`${searchTerms}::${filterTags.join(",")}::${styleFilters.join(",")}::${hueFilters.join(",")}::${hexFilters.join(",")}::${showFavoritesOnly}::${showTrashOnly}::${timeFilter?.range.start ?? ""}-${timeFilter?.range.end ?? ""}`}
          showTrashOnly={showTrashOnly}
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
        card={selectedCard}
        cardId={editingCardId}
        onCancel={handleEditCancel}
        onCardTypeClick={handleCardTypeClick}
        onTagClick={handleTagClick}
        open={!!editingCardId}
      />

      <TagManagementModal
        aiTags={tagManagementCard?.aiTags || []}
        onAddTag={handleAddTag}
        onOpenChange={(open) => !open && setTagManagementCardId(null)}
        onRemoveAiTag={handleRemoveAiTag}
        onRemoveTag={handleRemoveTag}
        open={!!tagManagementCardId}
        setTagInput={setTagInput}
        tagInput={tagInput}
        userTags={tagManagementCard?.tags || []}
      />

      <DragOverlay isDragActive={isDragActive} />
    </div>
  );
}
