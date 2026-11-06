import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { MAX_PINNED_CARDS } from "@teak/convex/shared/pins";
import type { OptimisticUpdate } from "convex/browser";
import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { useMemo } from "react";
import {
  applyBulkActionToCard,
  applyBulkUpdate,
  applyCardFieldUpdate,
  cardWithFolderIds,
  updateCardInSearchQueries,
  updateCardsInSearchQueries,
} from "../lib/cardQueryOptimisticUpdates";
import { inPinOrder, withPinnedFirst } from "../lib/pinnedCards";

/**
 * A mutation with its optimistic update, the same function on every render:
 * `withOptimisticUpdate` makes a new one each time it's called.
 */
const useOptimisticMutation = <Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  update: OptimisticUpdate<Mutation["_args"]>
) => {
  const run = useMutation(mutation);
  return useMemo(() => run.withOptimisticUpdate(update), [run, update]);
};

/**
 * The web app's only bindings of the card mutations. Each carries its
 * optimistic update, so every surface that edits a card (a menu, the dialog,
 * a key, the selection bar, WebMCP) shows the same card before the server
 * answers.
 */

const updateCardFieldLocally: OptimisticUpdate<
  FunctionArgs<typeof api.cards.updateCardField>
> = (localStore, args) => applyCardFieldUpdate(localStore, args);

export const useUpdateCardField = () =>
  useOptimisticMutation(api.cards.updateCardField, updateCardFieldLocally);

const bulkUpdateLocally: OptimisticUpdate<
  FunctionArgs<typeof api.cards.bulkUpdateCards>
> = (localStore, args) => applyBulkUpdate(localStore, args);

export const useBulkUpdateCards = () =>
  useOptimisticMutation(api.cards.bulkUpdateCards, bulkUpdateLocally);

const removeCardLocally: OptimisticUpdate<
  FunctionArgs<typeof api.cards.permanentDeleteCard>
> = (localStore, { id }) => {
  updateCardInSearchQueries(localStore, id, () => null);
};

export const usePermanentDeleteCard = () =>
  useOptimisticMutation(api.cards.permanentDeleteCard, removeCardLocally);

const setFoldersLocally: OptimisticUpdate<
  FunctionArgs<typeof api.folders.setCardFolders>
> = (localStore, { cardId, folderIds }) => {
  const now = Date.now();
  updateCardInSearchQueries(localStore, cardId, (card) =>
    cardWithFolderIds(card, folderIds, now)
  );
};

export const useSetCardFolders = () =>
  useOptimisticMutation(api.folders.setCardFolders, setFoldersLocally);

const addToFolderLocally: OptimisticUpdate<
  FunctionArgs<typeof api.folders.addCardsToFolder>
> = (localStore, { cardIds, folderId }) => {
  const now = Date.now();
  updateCardsInSearchQueries(localStore, new Set(cardIds), (card) =>
    applyBulkActionToCard(card, "addToFolder", [], now, { folderId })
  );
};

export const useAddCardsToFolder = () =>
  useOptimisticMutation(api.folders.addCardsToFolder, addToFolderLocally);

type PinnedCard = Doc<"cards">;

const setPinnedLocally: OptimisticUpdate<
  FunctionArgs<typeof api.cards.setCardPinned>
> = (localStore, { cardId, pinned }) => {
  const current = localStore.getQuery(api.cards.getPinnedCards, {});
  let changed: PinnedCard | null = null;
  updateCardInSearchQueries(localStore, cardId, (card) => {
    changed = pinned
      ? (withPinnedFirst(current ?? [], card)[0] ?? card)
      : { ...card, pinPosition: undefined };
    return changed;
  });
  if (current === undefined) {
    return;
  }
  if (!pinned) {
    localStore.setQuery(
      api.cards.getPinnedCards,
      {},
      current.filter((card: PinnedCard) => card._id !== cardId)
    );
    return;
  }
  const card: PinnedCard | null =
    changed ??
    current.find((candidate: PinnedCard) => candidate._id === cardId) ??
    null;
  if (card && current.length < MAX_PINNED_CARDS) {
    localStore.setQuery(
      api.cards.getPinnedCards,
      {},
      withPinnedFirst(current, card)
    );
  }
};

export const useSetCardPinned = () =>
  useOptimisticMutation(api.cards.setCardPinned, setPinnedLocally);

const reorderPinsLocally: OptimisticUpdate<
  FunctionArgs<typeof api.cards.reorderPinnedCards>
> = (localStore, { cardIds }) => {
  const current = localStore.getQuery(api.cards.getPinnedCards, {});
  if (current) {
    localStore.setQuery(
      api.cards.getPinnedCards,
      {},
      inPinOrder(current, cardIds)
    );
  }
};

export const useReorderPinnedCards = () =>
  useOptimisticMutation(api.cards.reorderPinnedCards, reorderPinsLocally);
