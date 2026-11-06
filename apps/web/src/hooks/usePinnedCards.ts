import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { captureEvent } from "@teak/convex/shared/analytics";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { useTranslations } from "@teak/i18n/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { useQuery } from "../lib/convexQueryHooks";
import type { LibraryView } from "../lib/libraryViews";
import { showsPinnedStrip } from "../lib/pinnedCards";
import { useReorderPinnedCards } from "./useCardMutations";

type PinnedCard = Doc<"cards">;

/** The pinned cards, first to last; undefined while they load. */
export function usePinnedCards(enabled = true): PinnedCard[] | undefined {
  return useQuery(api.cards.getPinnedCards, enabled ? {} : "skip");
}

/**
 * The library's pinned row: whether it shows, its cards, and how a drag
 * reorders them. The grid's own list leaves pinned cards out on the server
 * (`excludePinned`), and a pin's optimistic update takes the card out of it
 * at once.
 */
export function usePinnedStrip({
  addToFolderId,
  folderId,
  queryArgs,
  view = "all",
}: {
  addToFolderId?: string;
  folderId?: string;
  queryArgs: Parameters<typeof showsPinnedStrip>[0]["queryArgs"];
  view?: LibraryView;
}) {
  const t = useTranslations("hooks.pinnedCards");
  const shown = showsPinnedStrip({
    isAddingToFolder: Boolean(addToFolderId),
    isFolderView: Boolean(folderId),
    queryArgs,
    view,
  });
  const pinned = usePinnedCards();
  const reorderPinnedCards = useReorderPinnedCards();
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
  return {
    shown,
    strip: { cards: shown ? (pinned ?? EMPTY) : EMPTY, onReorder: reorderPins },
  };
}

const EMPTY: PinnedCard[] = [];
