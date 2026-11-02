import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  type CardPinSource,
  captureEvent,
} from "@teak/convex/shared/analytics";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { MAX_PINNED_CARDS } from "@teak/convex/shared/pins";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { updateCardInSearchQueries } from "../lib/cardQueryOptimisticUpdates";
import { useQuery } from "../lib/convexQueryHooks";
import type { LibraryView } from "../lib/libraryViews";
import {
  inPinOrder,
  isPinLimitError,
  isPinned,
  showsPinnedStrip,
  withPinnedFirst,
} from "../lib/pinnedCards";

type PinnedCard = Doc<"cards">;

/** The pinned cards, first to last; undefined while they load. */
export function usePinnedCards(enabled = true): PinnedCard[] | undefined {
  return useQuery(api.cards.getPinnedCards, enabled ? {} : "skip");
}

/**
 * Pins and unpins cards and reorders the pins. The strip and every list
 * update before the server answers; a refused pin (the cap) says why.
 */
export function usePinActions() {
  const t = useTranslations("hooks.pinnedCards");
  const setCardPinned = useMutation(
    api.cards.setCardPinned
  ).withOptimisticUpdate((localStore, { cardId, pinned }) => {
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
  });
  const reorderPinnedCards = useMutation(
    api.cards.reorderPinnedCards
  ).withOptimisticUpdate((localStore, { cardIds }) => {
    const current = localStore.getQuery(api.cards.getPinnedCards, {});
    if (current) {
      localStore.setQuery(
        api.cards.getPinnedCards,
        {},
        inPinOrder(current, cardIds)
      );
    }
  });

  const togglePin = useCallback(
    async (
      card: Pick<PinnedCard, "_id" | "pinPosition">,
      source: CardPinSource
    ) => {
      const pinned = !isPinned(card);
      try {
        await setCardPinned({ cardId: card._id, pinned });
        captureEvent("card_pin_toggled", { pinned, source });
      } catch (error) {
        if (isPinLimitError(error)) {
          toast.error(t("limit", { count: MAX_PINNED_CARDS }));
          return;
        }
        captureClientException(error, { operation: "card.pin" });
        toast.error(t(pinned ? "failed.pin" : "failed.unpin"));
      }
    },
    [setCardPinned, t]
  );

  const reorderPins = useCallback(
    async (cardIds: Id<"cards">[]) => {
      try {
        await reorderPinnedCards({ cardIds });
        captureEvent("card_pins_reordered", {
          count: cardIds.length,
          source: "strip",
        });
      } catch (error) {
        captureClientException(error, { operation: "card.reorder_pins" });
        toast.error(t("failed.reorder"));
      }
    },
    [reorderPinnedCards, t]
  );

  return { reorderPins, togglePin };
}

/**
 * The library's pinned row: whether it shows, its cards, and pin and
 * reorder actions for the grid and the row. The grid's own list leaves
 * pinned cards out on the server (`excludePinned`), and a pin's optimistic
 * update takes the card out of it at once.
 */
export function usePinnedStrip({
  view = "all",
  ...where
}: Omit<Parameters<typeof showsPinnedStrip>[0], "view"> & {
  view?: LibraryView;
}) {
  const shown = showsPinnedStrip({ ...where, view });
  const pinned = usePinnedCards();
  const { reorderPins, togglePin } = usePinActions();
  const toggle = useCallback(
    (cardId: string, source: "grid" | "shortcut" = "grid") => {
      const pin = pinned?.find((card) => card._id === cardId);
      togglePin(
        { _id: cardId as Id<"cards">, pinPosition: pin?.pinPosition },
        source
      ).catch(() => undefined);
    },
    [pinned, togglePin]
  );
  return {
    shown,
    strip: { cards: shown ? (pinned ?? EMPTY) : EMPTY, onReorder: reorderPins },
    togglePin: toggle,
  };
}

const EMPTY: PinnedCard[] = [];
