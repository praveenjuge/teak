"use client";

import { api } from "@teak/convex";
import { useConvex } from "convex/react";
import { useEffect } from "react";
import {
  getModelContext,
  registerTeakWebMcpTools,
  WEBMCP_TOOL_NAMES,
} from "@/lib/webmcp";

/**
 * Registers Teak's read-only WebMCP tools with the browser when the draft
 * `document.modelContext` API exists. Mounted for signed-in users only; the
 * tools run that user's Convex queries, so no extra auth is needed.
 */
export function WebMcpTools() {
  const convex = useConvex();

  useEffect(() => {
    const modelContext = getModelContext();
    if (!modelContext) {
      return;
    }
    const controller = new AbortController();
    registerTeakWebMcpTools(
      modelContext,
      {
        searchCards: (args) => convex.query(api.cards.searchCards, args),
        getCard: (cardId) =>
          convex.query(api.cards.getCardByUrlId, { id: cardId }),
      },
      { signal: controller.signal }
    ).then(
      () => {
        if (process.env.NODE_ENV !== "production") {
          (window as Window & { __teakWebmcp?: unknown }).__teakWebmcp = {
            tools: [...WEBMCP_TOOL_NAMES],
          };
        }
      },
      () => {
        controller.abort();
        // Registration failing (unsupported schema, revoked permission) must
        // never break the app; the page simply stays non-agent-callable.
      }
    );
    return () => {
      controller.abort();
    };
  }, [convex]);

  return null;
}
