"use client";

import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
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

const recordToolEvent = (type: WebMcpToolEventType): void => {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  console.info(`[webmcp] event: ${type}`);
  const debug = (window as Window & { __teakWebmcp?: TeakWebmcpDebugHandle })
    .__teakWebmcp;
  if (debug) {
    debug.events[type] = (debug.events[type] ?? 0) + 1;
  }
};

/**
 * Registers Teak's WebMCP tools with the browser when the draft
 * `document.modelContext` API exists. Mounted for signed-in users only; the
 * tools run that user's Convex queries and mutations, so no extra auth is
 * needed.
 */
export function WebMcpTools() {
  const convex = useConvex();

  useEffect(() => {
    const modelContext = getModelContext();
    if (!modelContext) {
      return;
    }
    const controller = new AbortController();
    type DebugWindow = Window & { __teakWebmcp?: TeakWebmcpDebugHandle };
    const clearDebugHandle = (): void => {
      if (process.env.NODE_ENV !== "production") {
        // Drop the debug handle so DevTools never shows tools that are no
        // longer registered after unmount, sign-out, or failed registration.
        (window as DebugWindow).__teakWebmcp = undefined;
      }
    };
    if (process.env.NODE_ENV !== "production") {
      // Initialize before subscribing so registration-time toolchange
      // events are counted too; tools fill in once registration succeeds.
      (window as DebugWindow).__teakWebmcp = { events: {}, tools: [] };
    }
    const unsubscribeEvents = subscribeWebMcpToolEvents(
      modelContext,
      recordToolEvent
    );
    registerTeakWebMcpTools(
      modelContext,
      {
        searchCards: (args) => convex.query(api.cards.searchCards, args),
        getCard: (cardId) =>
          convex.query(api.cards.getCardByUrlId, { id: cardId }),
        createCard: async (args) => {
          const id = await convex.mutation(api.cards.createCard, args);
          return String(id);
        },
        updateCardField: ({ cardId, field, value }) =>
          convex.mutation(api.cards.updateCardField, {
            // Tool card IDs are Convex row IDs validated by a read first;
            // the mutation revalidates the ID shape and row ownership.
            cardId: cardId as Id<"cards">,
            field,
            value,
          }),
      },
      { signal: controller.signal }
    ).then(
      () => {
        if (process.env.NODE_ENV !== "production") {
          const debug = (window as DebugWindow).__teakWebmcp;
          if (debug) {
            debug.tools = [...WEBMCP_TOOL_NAMES];
          }
        }
      },
      () => {
        unsubscribeEvents();
        controller.abort();
        clearDebugHandle();
        // Registration failing (unsupported schema, revoked permission) must
        // never break the app; the page simply stays non-agent-callable.
      }
    );
    return () => {
      unsubscribeEvents();
      controller.abort();
      clearDebugHandle();
    };
  }, [convex]);

  return null;
}
