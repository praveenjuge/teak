"use client";

import { api } from "@teak/convex";
import { useConvex } from "convex/react";
import { useEffect } from "react";
import { useBulkUpdateCards, useSetCardPinned } from "@/hooks/useCardMutations";
import type { WebMcpToolEventType } from "@/lib/webmcp";
import { getModelContext } from "@/lib/webmcpContext";

interface TeakWebmcpDebugHandle {
  events: Partial<Record<WebMcpToolEventType, number>>;
  tools: string[];
}

type DebugWindow = Window & { __teakWebmcp?: TeakWebmcpDebugHandle };

const createDevDebugHandle = (toolNames: readonly string[]) => {
  if (process.env.NODE_ENV === "production") {
    return {
      clear: () => undefined,
      markRegistered: () => undefined,
      recordEvent: (_type: WebMcpToolEventType) => undefined,
    };
  }
  const handle: TeakWebmcpDebugHandle = { events: {}, tools: [] };
  (window as DebugWindow).__teakWebmcp = handle;
  return {
    clear: () => {
      if ((window as DebugWindow).__teakWebmcp === handle) {
        (window as DebugWindow).__teakWebmcp = undefined;
      }
    },
    markRegistered: () => {
      handle.tools = [...toolNames];
    },
    recordEvent: (type: WebMcpToolEventType) => {
      console.info(`[webmcp] event: ${type}`);
      handle.events[type] = (handle.events[type] ?? 0) + 1;
    },
  };
};

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
    let stop = (): void => controller.abort();
    // Only a browser with WebMCP downloads the tools.
    const register = async () => {
      const {
        registerTeakWebMcpTools,
        subscribeWebMcpToolEvents,
        WEBMCP_TOOL_NAMES,
      } = await import("@/lib/webmcp");
      if (controller.signal.aborted) {
        return;
      }
      const debug = createDevDebugHandle(WEBMCP_TOOL_NAMES);
      const unsubscribeEvents = subscribeWebMcpToolEvents(
        modelContext,
        debug.recordEvent
      );
      stop = () => {
        unsubscribeEvents();
        controller.abort();
        debug.clear();
      };
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
      debug.markRegistered();
    };
    register().catch(() => stop());
    return () => stop();
  }, [bulkUpdateCards, convex, setCardPinned]);

  return null;
}
