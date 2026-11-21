import { libraryQuery } from "./libraryUrl";

// Teak's URLs carry plain strings (`?q=1.0` stays "1.0"), shared with other
// apps through @teak/convex/shared/webRoutes, so search params are kept as
// written instead of being parsed as JSON.
export const parseSearch = (search: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(search));

// Written the way the library writes its links (`libraryQuery`), so the URL
// the router commits matches the one the page compares it with.
export const stringifySearch = (search: Record<string, unknown>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const query = libraryQuery(params);
  return query ? `?${query}` : "";
};
