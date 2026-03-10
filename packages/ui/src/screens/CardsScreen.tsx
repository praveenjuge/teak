"use client";

import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { SEARCH_DEFAULT_CARD_LIMIT } from "@teak/convex/shared";
import { ConnectedCardModal } from "@teak/ui/card-modal";
import type { CardWithUrls } from "@teak/ui/cards";
import { Button } from "@teak/ui/components/ui/button";
import { CardsGridSkeleton } from "@teak/ui/feedback/CardsGridSkeleton";
import { DragOverlay } from "@teak/ui/feedback/DragOverlay";
import type { AddCardFormProps } from "@teak/ui/forms";
import { AddCardEmptyState, AddCardForm } from "@teak/ui/forms";
import { MasonryGrid } from "@teak/ui/grids";
import {
  useCardActions,
  useCardClipboard,
  useCardModalFilterActions,
  useCardsSearchController,
} from "@teak/ui/hooks";
import { TagManagementModal } from "@teak/ui/modals";
import { CardsSearchHeader } from "@teak/ui/search";
import { Authenticated, AuthLoading, useMutation } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react/cache/hooks";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type DropzonePropGetter = (
  props?: Record<string, unknown>
) => Record<string, unknown>;

interface CardsScreenProps {
  contentContainerClassName?: string;
  getInputProps: DropzonePropGetter;
  getRootProps: DropzonePropGetter;
  isDragActive: boolean;
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
  getRootProps,
  getInputProps,
  isDragActive,
  contentContainerClassName,
  toastIdPrefix,
}: CardsScreenProps) {
  const [tagManagementCardId, setTagManagementCardId] = useState<string | null>(
    null
  );
  const [tagInput, setTagInput] = useState("");
  const searchController = useCardsSearchController();

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
      displayCards.find((card: Doc<"cards">) => card._id === selectedCardId) ??
      null,
    [displayCards, selectedCardId]
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
      const newTags = [...currentTags, tag];
      void updateCardField({
        cardId: tagManagementCardId as Id<"cards">,
        field: "tags",
        value: newTags,
      });
      setTagInput("");
    }
  }, [tagInput, tagManagementCard?.tags, tagManagementCardId, updateCardField]);

  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      const currentTags = tagManagementCard?.tags || [];
      const newTags = currentTags.filter((tag: string) => tag !== tagToRemove);

      if (tagManagementCardId) {
        void updateCardField({
          cardId: tagManagementCardId as Id<"cards">,
          field: "tags",
          value: newTags.length > 0 ? newTags : undefined,
        });
      }
    },
    [tagManagementCard?.tags, tagManagementCardId, updateCardField]
  );

  const handleRemoveAiTag = useCallback(
    (tagToRemove: string) => {
      if (tagManagementCardId) {
        void updateCardField({
          cardId: tagManagementCardId as Id<"cards">,
          field: "removeAiTag",
          tagToRemove,
        });
      }
    },
    [tagManagementCardId, updateCardField]
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

  const AddCardFormWrapper = useCallback(() => {
    return (
      <AddCardForm
        onUpgrade={onUpgrade}
        UpgradeLinkComponent={UpgradeLinkComponent}
        upgradeUrl={upgradeUrl}
      />
    );
  }, [UpgradeLinkComponent, onUpgrade, upgradeUrl]);

  const renderEmptyState = () => {
    if (cardsStatus === "LoadingFirstPage") {
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
      <CardsSearchHeader {...searchBarProps} SettingsButton={SettingsButton} />

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
    <div {...getRootProps()} className="relative">
      <input {...getInputProps()} />
      {contentContainerClassName ? (
        <main className={contentContainerClassName}>{content}</main>
      ) : (
        content
      )}
      <DragOverlay isDragActive={isDragActive} />
    </div>
  );
}
