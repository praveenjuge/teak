import type { WebMcpModelContext } from "./webmcp";

// Apart from the tools, so the app can check for WebMCP without loading them:
// most browsers don't have it, and they never download the tool definitions.

/**
 * Resolve the WebMCP entry point. The draft API moved from
 * `navigator.modelContext` to `document.modelContext`, so both are probed.
 */
export const getModelContext = (): WebMcpModelContext | null => {
  if (typeof document !== "undefined") {
    const withContext = document as Document & {
      modelContext?: WebMcpModelContext;
    };
    if (withContext.modelContext) {
      return withContext.modelContext;
    }
  }
  if (typeof navigator !== "undefined") {
    const withContext = navigator as Navigator & {
      modelContext?: WebMcpModelContext;
    };
    if (withContext.modelContext) {
      return withContext.modelContext;
    }
  }
  return null;
};
