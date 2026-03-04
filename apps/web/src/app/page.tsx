"use client";

import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { SEARCH_DEFAULT_CARD_LIMIT } from "@teak/convex/shared";
import type { CardWithUrls } from "@teak/ui/cards";
import { Button } from "@teak/ui/components/ui/button";
import { CardsGridSkeleton } from "@teak/ui/feedback/CardsGridSkeleton";
import { DragOverlay } from "@teak/ui/feedback/DragOverlay";
import { AddCardEmptyState } from "@teak/ui/forms";
import {
  useCardClipboard,
  useCardModalFilterActions,
  useCardsSearchController,
} from "@teak/ui/hooks";
import { TagManagementModal } from "@teak/ui/modals";
import { CardsSearchHeader } from "@teak/ui/search";
import { Authenticated, AuthLoading, useMutation } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react/cache/hooks";
import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CardModal } from "@/components/CardModal";
import { MasonryGrid } from "@/components/MasonryGrid";
import { useCardActions } from "@/hooks/useCardActions";
import { useGlobalDragDrop } from "@/hooks/useGlobalDragDrop";
import { metrics } from "@/lib/metrics";

export default function HomePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cardIdFromUrl = searchParams.get("card");
  const [editingCardId, setEditingCardId] = useState<string | null>(
    cardIdFromUrl
  );
  const [tagManagementCardId, setTagManagementCardId] = useState<string | null>(
    null
  );
  const [tagInput, setTagInput] = useState("");
  const searchController = useCardsSearchController();

  const setCardUrlParam = useCallback(
    (cardId: string | null, replace = false) => {
      const params = new URLSearchParams(searchParams.toString());

      if (cardId) {
        params.set("card", cardId);
      } else {
        params.delete("card");
      }

      const nextQuery = params.toString();
      const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;

      if (replace) {
        router.replace(nextUrl);
        return;
      }

      router.push(nextUrl);
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    setEditingCardId(cardIdFromUrl);
  }, [cardIdFromUrl]);

  const queryArgs = searchController.queryArgs;

  const {
    results: cards,
    status: cardsStatus,
    loadMore,
  } = usePaginatedQuery(api.cards.searchCardsPaginated, queryArgs, {
    initialNumItems: SEARCH_DEFAULT_CARD_LIMIT,
  });

  const {
    addFilter,
    addKeywordTag,
    clearAllFilters,
    displayCards,
    hasNoFilters,
    resetKey,
    searchBarProps,
    setRemoteCards,
    showTrashOnly,
  } = searchController;

  useEffect(() => {
    setRemoteCards(cards);
  }, [cards, setRemoteCards]);

  const selectedCard = useMemo(
    () =>
      displayCards.find((card: Doc<"cards">) => card._id === editingCardId) ??
      null,
    [displayCards, editingCardId]
  );

  const cardActions = useCardActions({
    onDeleteSuccess: (message?: string) => message && toast(message),
    onRestoreSuccess: (message?: string) => message && toast(message),
    onPermanentDeleteSuccess: (message?: string) => message && toast(message),
    onError: (_error: Error, operation: string) => {
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
  const { handleCopyImage } = useCardClipboard();

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

  const handleCardClick = (card: CardWithUrls & Record<string, unknown>) => {
    metrics.modalOpened("card");
    setEditingCardId(card._id);
    setCardUrlParam(card._id);
  };

  const handleEditCancel = () => {
    setEditingCardId(null);
    setCardUrlParam(null, true);
  };

  const handleInvalidCard = () => {
    setEditingCardId(null);
    setCardUrlParam(null, true);
  };

  const { handleCardTypeClick, handleTagClick } = useCardModalFilterActions({
    addFilter,
    addKeywordTag,
    onCloseModal: handleEditCancel,
  });

  const settingsButton = (
    <Button asChild size="icon" variant="outline">
      <Link href="/settings">
        <Settings />
      </Link>
    </Button>
  );

  const renderEmptyState = () => {
    if (cardsStatus === "LoadingFirstPage") {
      return <CardsGridSkeleton />;
    }

    if (displayCards.length === 0 && hasNoFilters) {
      return (
        <AddCardEmptyState UpgradeLinkComponent={Link} upgradeUrl="/settings" />
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
      <CardsSearchHeader {...searchBarProps} SettingsButton={settingsButton} />

      {displayCards.length > 0 ? (
        <MasonryGrid
          batchSize={SEARCH_DEFAULT_CARD_LIMIT}
          filteredCards={displayCards}
          hasMore={
            cardsStatus === "CanLoadMore" || cardsStatus === "LoadingMore"
          }
          initialBatchSize={SEARCH_DEFAULT_CARD_LIMIT}
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
          onLoadMore={() => loadMore(SEARCH_DEFAULT_CARD_LIMIT)}
          onPermanentDeleteCard={(cardId) =>
            cardActions.handlePermanentDeleteCard(cardId as Id<"cards">)
          }
          onRestoreCard={(cardId) =>
            cardActions.handleRestoreCard(cardId as Id<"cards">)
          }
          onToggleFavorite={(cardId) =>
            cardActions.handleToggleFavorite(cardId as Id<"cards">)
          }
          resetKey={resetKey}
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
        onInvalidCard={handleInvalidCard}
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
