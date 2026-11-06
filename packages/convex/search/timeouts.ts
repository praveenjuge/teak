/**
 * How long a search waits on the Core Worker before it answers without it.
 * The API answers within its own request, so it waits least; the web grid's
 * scores land after its first page, so it can wait longer.
 */
export const API_SEARCH_TIMEOUT_MS = 1500;
export const GRID_RELEVANCE_TIMEOUT_MS = 3000;
export const GRID_SEMANTIC_TIMEOUT_MS = 5000;
