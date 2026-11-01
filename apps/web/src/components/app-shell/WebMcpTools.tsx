"use client";

import { api } from "@teak/convex";
import { useConvex } from "convex/react";
import { useEffect } from "react";
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
      );
      debug.markRegistered();
    };
    register().catch(() => stop());
    return () => stop();
  }, [convex]);

  return null;
}
