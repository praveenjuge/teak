import { api } from "@teak/convex";
import { SEARCH_DEFAULT_CARD_LIMIT } from "@teak/convex/shared";
import type { FunctionReference } from "convex/server";
import { initialCardsSearchQueryArgs } from "../hooks/useCardsSearchController";
import { folderIdForPath } from "./folders";
import { libraryViewForPath } from "./libraryViews";
import { parseSearchUrlState } from "./searchUrlState";

export interface FirstLoadQuery {
  args: Record<string, unknown>;
  query: FunctionReference<"query">;
}

/**
 * The queries a signed-in page at `url` asks for as it first renders: the
 * owner's profile, the sidebar's folders and New menu, and on a page of
 * cards, whether the vault is still being set up (cards wait on it) and a
 * library view's first page. Subscribing to them as the client starts sends them
 * with its sign-in, instead of each waiting for the one before it.
 */
export function firstLoadQueries(
  url: Pick<URL, "pathname" | "searchParams">
): FirstLoadQuery[] {
  const queries: FirstLoadQuery[] = [
    { query: api.auth.getAuthUser, args: {} },
    { query: api.auth.getCardCreationStatus, args: {} },
    { query: api.folders.listFolders, args: {} },
  ];
  const view = libraryViewForPath(url.pathname);
  if (view || folderIdForPath(url.pathname)) {
    queries.push({ query: api.card.vaultSetup.getVaultSetup, args: {} });
  }
  const cardsArgs = view
    ? initialCardsSearchQueryArgs(view, parseSearchUrlState(url.searchParams))
    : null;
  if (cardsArgs) {
    queries.push({
      query: api.cards.searchCardsPaginated,
      // The first page exactly as the cached usePaginatedQuery
      // (convex-helpers) asks for it; its page id is always 0.
      args: {
        ...cardsArgs,
        paginationOpts: {
          cursor: null,
          id: 0,
          numItems: SEARCH_DEFAULT_CARD_LIMIT,
        },
      },
    });
  }
  return queries;
}
