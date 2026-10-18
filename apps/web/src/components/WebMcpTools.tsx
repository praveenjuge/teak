"use client";

import { api } from "@teak/convex";
import { useConvex } from "convex/react";
import { useEffect } from "react";
import {
  getModelContext,
  registerTeakWebMcpTools,
  subscribeWebMcpToolEvents,
  WEBMCP_TOOL_NAMES,
  type WebMcpToolEventType,
} from "@/lib/webmcp";

interface TeakWebmcpDebugHandle {
  events: Partial<Record<WebMcpToolEventType, number>>;
  tools: string[];
}

type DebugWindow = Window & { __teakWebmcp?: TeakWebmcpDebugHandle };

const createDevDebugHandle = () => {
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
      handle.tools = [...WEBMCP_TOOL_NAMES];
    },
    recordEvent: (type: WebMcpToolEventType) => {
      console.info(`[webmcp] event: ${type}`);
      handle.events[type] = (handle.events[type] ?? 0) + 1;
    },
  };
};

export function WebMcpTools() {
  const convex = useConvex();

  useEffect(() => {
    const modelContext = getModelContext();
    if (!modelContext) {
      return;
    }
    const controller = new AbortController();
    const debug = createDevDebugHandle();
    const unsubscribeEvents = subscribeWebMcpToolEvents(
      modelContext,
      debug.recordEvent
    );
    const stop = (): void => {
      unsubscribeEvents();
      controller.abort();
      debug.clear();
    };
    registerTeakWebMcpTools(
      modelContext,
      {
        searchCards: (args) => convex.query(api.cards.searchCards, args),
        getCard: (cardId) =>
          convex.query(api.cards.getCardByUrlId, { id: cardId }),
        createCard: (args) =>
          convex.mutation(api.cards.createCard, { ...args, source: "web" }),
        editCardTags: ({ action, cardId, tags }) =>
          convex.mutation(api.cards.bulkUpdateCards, {
            action,
            cardIds: [cardId],
            tags,
          }),
        setCardFavorite: ({ cardId, favorited }) =>
          convex.mutation(api.cards.updateCardField, {
            cardId,
            field: "isFavorited",
            value: favorited,
          }),
      },
      { signal: controller.signal }
    ).then(debug.markRegistered, stop);
    return stop;
  }, [convex]);

  return null;
}
