"use client";

import { api } from "@teak/convex";
import { useConvex } from "convex/react";
import { useEffect } from "react";
import { useBulkUpdateCards, useSetCardPinned } from "@/hooks/useCardMutations";
import { getModelContext } from "@/lib/webmcpContext";

export function WebMcpTools() {
  const convex = useConvex();
  // The app's own bindings, so a change an agent makes shows at once, as the
  // same change made by hand does. A pin from WebMCP sends no
  // `card_pin_toggled`: the event catalog has no source for it.
  const bulkUpdateCards = useBulkUpdateCards();
  const setCardPinned = useSetCardPinned();

  useEffect(() => {
    const modelContext = getModelContext();
    if (!modelContext) {
      return;
    }
    const controller = new AbortController();
    // Only a browser with WebMCP downloads the tools.
    const register = async () => {
      const { registerTeakWebMcpTools } = await import("@/lib/webmcp");
      if (controller.signal.aborted) {
        return;
      }
      await registerTeakWebMcpTools(
        modelContext,
        {
          searchCards: (args) => convex.query(api.cards.searchCards, args),
          getCard: (cardId) =>
            convex.query(api.cards.getCardByUrlId, { id: cardId }),
          createCard: (args) =>
            convex.mutation(api.cards.createCard, { ...args, source: "web" }),
          editCardTags: ({ action, cardId, tags }) =>
            bulkUpdateCards({ action, cardIds: [cardId], tags }),
          setCardFavorite: async ({ cardId, favorited }) => {
            const { failedIds } = await bulkUpdateCards({
              action: favorited ? "favorite" : "unfavorite",
              cardIds: [cardId],
            });
            if (failedIds.length > 0) {
              throw new Error("Card not found");
            }
            return null;
          },
          setCardPinned: ({ cardId, pinned }) =>
            setCardPinned({ cardId, pinned }),
        },
        { signal: controller.signal }
      );
    };
    register().catch(() => controller.abort());
    return () => controller.abort();
  }, [bulkUpdateCards, convex, setCardPinned]);

  return null;
}
