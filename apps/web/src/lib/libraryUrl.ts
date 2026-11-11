/**
 * The library's URL: which card is open (`card`), and the query string every
 * library link writes. The search's own params (`q`, `sort`, `type`...) are
 * read and written by `searchUrlState`; this keeps the rest in one place.
 */

import { CARD_PARAM } from "@teak/convex/shared/webRoutes";

export const ADD_TO_FOLDER_PARAM = "addTo";

/** A query string as the library writes it: commas between values stay. */
export const libraryQuery = (params: URLSearchParams): string =>
  params.toString().replace(/%2C/g, ",");

export const libraryHref = (
  pathname: string,
  params: URLSearchParams
): string => {
  const query = libraryQuery(params);
  return query ? `${pathname}?${query}` : pathname;
};

export const searchWithout = (
  search: string,
  ...names: string[]
): URLSearchParams => {
  const params = new URLSearchParams(search);
  for (const name of names) {
    params.delete(name);
  }
  return params;
};

/**
 * The URL with this card open, or none: `search` keeps its search and
 * filters, so closing the card shows the same list.
 */
export const cardHref = (
  cardId: string | null,
  pathname = "/",
  search = ""
): string => {
  const params = new URLSearchParams(search);
  if (cardId) {
    params.set(CARD_PARAM, cardId);
  } else {
    params.delete(CARD_PARAM);
  }
  return libraryHref(pathname, params);
};

export const addToFolderHref = (folderId: string): string =>
  libraryHref("/", new URLSearchParams({ [ADD_TO_FOLDER_PARAM]: folderId }));
