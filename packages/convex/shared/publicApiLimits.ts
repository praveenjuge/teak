// Page and batch limits of the public API, shared by its HTTP routes, MCP
// tools and OpenAPI document.
export const PUBLIC_API_DEFAULT_LIMIT = 50;
export const PUBLIC_API_MAX_LIMIT = 100;
export const PUBLIC_API_MAX_BULK_ITEMS = 100;

/** A page size within 1..PUBLIC_API_MAX_LIMIT; the default when not a number. */
export const clampPublicApiLimit = (limit?: number): number => {
  if (!(typeof limit === "number" && Number.isFinite(limit))) {
    return PUBLIC_API_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(limit, PUBLIC_API_MAX_LIMIT));
};
