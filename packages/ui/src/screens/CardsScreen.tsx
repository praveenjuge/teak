"use client";

import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { SEARCH_DEFAULT_CARD_LIMIT } from "@teak/convex/shared";
import { addTelemetryBreadcrumb } from "@teak/convex/shared/client-telemetry";
import { trackSearch } from "@teak/convex/shared/metrics";
import { ConnectedCardModal } from "@teak/ui/card-modal";
import type { CardWithUrls } from "@teak/ui/cards";
import { Button } from "@teak/ui/components/ui/button";
import { CardsGridSkeleton } from "@teak/ui/feedback/CardsGridSkeleton";
import type { AddCardFormProps } from "@teak/ui/forms";
import { AddCardActions, AddCardEmptyState, AddCardForm } from "@teak/ui/forms";
import { MasonryGrid } from "@teak/ui/grids";
import {
  useCardActions,
  useCardClipboard,
  useCardModalFilterActions,
  useCardsSearchController,
} from "@teak/ui/hooks";
import { TagManagementModal } from "@teak/ui/modals";
import { CardsSearchHeader } from "@teak/ui/search";
import { Authenticated, AuthLoading } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react/cache/hooks";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface CardsScreenProps {
  contentContainerClassName?: string;
  onCloseCard: () => void;
  onOpenCard: (cardId: string) => void;
  onUpgrade?: AddCardFormProps["onUpgrade"];
  SettingsButton?: ReactNode;
  selectedCardId: string | null;
  toastIdPrefix?: string;
  UpgradeLinkComponent?: AddCardFormProps["UpgradeLinkComponent"];
  upgradeUrl: string;
}

export function CardsScreen({
  selectedCardId,
  onOpenCard,
  onCloseCard,
  onUpgrade,
  SettingsButton,
  UpgradeLinkComponent,
  upgradeUrl,
  contentContainerClassName,
  toastIdPrefix,
}: CardsScreenProps) {
  const [tagManagementCardId, setTagManagementCardId] = useState<string | null>(
    null
  );
  const [tagInput, setTagInput] = useState("");
  const draftContentRef = useRef("");
  const searchController = useCardsSearchController();

  const queryArgs = searchController.queryArgs;
  const searchKey = useMemo(() => JSON.stringify(queryArgs), [queryArgs]);
  const searchTimingRef = useRef({
    key: searchKey,
    startedAt: performance.now(),
  });
  const reportedSearchKeyRef = useRef<string | null>(null);
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
    updateCachedCard,
  } = searchController;

  useEffect(() => {
    setRemoteCards(cards, searchKey);
  }, [cards, searchKey, setRemoteCards]);

  useEffect(() => {
    searchTimingRef.current = {
      key: searchKey,
      startedAt: performance.now(),
    };
    reportedSearchKeyRef.current = null;
  }, [searchKey]);

  useEffect(() => {
    if (
      !searchController.hasActiveSearch ||
      cardsStatus === "LoadingFirstPage" ||
      reportedSearchKeyRef.current === searchKey
    ) {
      return;
    }
    reportedSearchKeyRef.current = searchKey;
    const durationMs = performance.now() - searchTimingRef.current.startedAt;
    trackSearch({ durationMs, resultCount: cards.length });
    addTelemetryBreadcrumb({
      attributes: {
        "duration.ms": durationMs,
        "filter.count": Object.keys(queryArgs).length,
        "result.count": cards.length,
      },
      category: "search",
      message: "card.search.completed",
    });
  }, [
    cards.length,
    cardsStatus,
    queryArgs,
    searchController.hasActiveSearch,
    searchKey,
  ]);

  const selectedCard = useMemo(
    () =>
      displayCards.find((card: Doc<"cards">) => card._id === selectedCardId) ??
      null,
    [displayCards, selectedCardId]
  );

  const cardActions = useCardActions({
    onDeleteSuccess: (message?: string) => message && toast(message),
    onRestoreSuccess: (message?: string) => message && toast(message),
    onPermanentDeleteSuccess: (message?: string) => message && toast(message),
    onError: (_error: Error, operation: string) => {
      toast.error(
        `Failed to ${operation === "update removeAiTag" ? "remove tag" : operation}`
      );
    },
    onCardUpdate: updateCachedCard,
  });

  const tagManagementCard = useMemo(
    () =>
      displayCards.find(
        (card: Doc<"cards">) => card._id === tagManagementCardId
      ) ?? null,
    [displayCards, tagManagementCardId]
  );

  const handleAddTags = useCallback((cardId: string) => {
    setTagManagementCardId(cardId);
  }, []);

  const { handleCopyImage } = useCardClipboard();

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim().toLowerCase();
    const currentTags = tagManagementCard?.tags || [];

    if (tag && !currentTags.includes(tag) && tagManagementCardId) {
      // Optimistic: the next edit builds on this list even before the server
      // confirms it, and failures surface through onError as a toast.
      void cardActions.updateField(tagManagementCardId as Id<"cards">, "tags", [
        ...currentTags,
        tag,
      ]);
      setTagInput("");
    }
  }, [cardActions, tagInput, tagManagementCard?.tags, tagManagementCardId]);

  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      const currentTags = tagManagementCard?.tags || [];
      const newTags = currentTags.filter((tag: string) => tag !== tagToRemove);

      if (tagManagementCardId) {
        void cardActions.updateField(
          tagManagementCardId as Id<"cards">,
          "tags",
          newTags.length > 0 ? newTags : undefined
        );
      }
    },
    [cardActions, tagManagementCard?.tags, tagManagementCardId]
  );

  const handleRemoveAiTag = useCallback(
    (tagToRemove: string) => {
      if (tagManagementCardId) {
        void cardActions.updateField(
          tagManagementCardId as Id<"cards">,
          "removeAiTag",
          undefined,
          tagToRemove
        );
      }
    },
    [cardActions, tagManagementCardId]
  );

  const handleCardClick = useCallback(
    (card: CardWithUrls & Record<string, unknown>) => {
      onOpenCard(card._id);
    },
    [onOpenCard]
  );

  const { handleCardTypeClick, handleTagClick } = useCardModalFilterActions({
    addFilter,
    addKeywordTag,
    onCloseModal: onCloseCard,
  });

  const handleInvalidSelectedCard = useCallback(() => {
    onCloseCard();
    toast.error("Card not found");
  }, [onCloseCard]);

  const AddCardFormWrapper = useCallback(
    () => (
      <AddCardForm
        draftContentRef={draftContentRef}
        onUpgrade={onUpgrade}
        UpgradeLinkComponent={UpgradeLinkComponent}
        upgradeUrl={upgradeUrl}
      />
    ),
    [UpgradeLinkComponent, onUpgrade, upgradeUrl]
  );

  const renderEmptyState = () => {
    // A debounced search that hasn't been sent yet is still loading, not empty.
    if (
      cardsStatus === "LoadingFirstPage" ||
      searchController.isSearchPending
    ) {
      return <CardsGridSkeleton />;
    }

    if (displayCards.length === 0 && hasNoFilters) {
      return (
        <AddCardEmptyState
          UpgradeLinkComponent={UpgradeLinkComponent}
          upgradeUrl={upgradeUrl}
        />
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

  const content = (
    <>
      <CardsSearchHeader
        {...searchBarProps}
        HeaderActions={
          <AddCardActions onUpgrade={onUpgrade} upgradeUrl={upgradeUrl} />
        }
        SettingsButton={SettingsButton}
      />

      {displayCards.length > 0 ? (
        <MasonryGrid
          AddCardFormComponent={AddCardFormWrapper}
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
          showAddForm={!showTrashOnly}
          showBulkActions={true}
          showTrashOnly={showTrashOnly}
          toastIdPrefix={toastIdPrefix}
        />
      ) : (
        <>
          <AuthLoading>
            <CardsGridSkeleton />
          </AuthLoading>
          <Authenticated>{renderEmptyState()}</Authenticated>
        </>
      )}

      <ConnectedCardModal
        card={selectedCard}
        cardId={selectedCardId}
        onCancel={onCloseCard}
        onCardTypeClick={handleCardTypeClick}
        onCardUpdate={updateCachedCard}
        onInvalidCard={handleInvalidSelectedCard}
        onTagClick={handleTagClick}
        open={!!selectedCardId}
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
    </>
  );

  return (
    <div className="relative">
      {contentContainerClassName ? (
        <main className={contentContainerClassName}>{content}</main>
      ) : (
        content
      )}
    </div>
  );
}
