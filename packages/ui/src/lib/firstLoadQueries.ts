import { api } from "@teak/convex";
import { SEARCH_DEFAULT_CARD_LIMIT } from "@teak/convex/shared";
import type { FunctionReference } from "convex/server";
import { initialCardsSearchQueryArgs } from "../hooks/cardsSearchState";
import { type FolderSummary, folderIdForPath } from "./folders";
import { libraryViewForPath } from "./libraryViews";
import { parseSearchUrlState } from "./searchUrlState";

export interface FirstLoadQuery {
  args: Record<string, unknown>;
  query: FunctionReference<"query">;
}

export interface FirstLoadContext {
  /**
   * The folders already loaded (the sidebar's list). A folder page's cards
   * wait on the folder's kind, so they are warmed only for a manual folder
   * found here.
   */
  folders?: readonly Pick<FolderSummary, "_id" | "kind">[];
}

/**
 * The queries a signed-in page at `url` asks for as it first renders: the
 * owner's profile, the sidebar's folders and New menu, and on a page of
 * cards, whether the vault is still being set up (cards wait on it) and a
 * library view's or manual folder's first page. Subscribing to them as the
 * client starts, or as a link to the page is about to be clicked, sends them
 * together instead of each waiting for the component before it.
 */
export function firstLoadQueries(
  url: Pick<URL, "pathname" | "searchParams">,
  { folders }: FirstLoadContext = {}
): FirstLoadQuery[] {
  const queries: FirstLoadQuery[] = [
    { query: api.auth.getAuthUser, args: {} },
    { query: api.auth.getCardCreationStatus, args: {} },
    { query: api.folders.listFolders, args: {} },
  ];
  if (url.pathname === "/tags") {
    queries.push({ query: api.tags.listTagSummary, args: {} });
    return queries;
  }
  if (url.pathname === "/settings") {
    queries.push(
      { query: api.auth.getCurrentUser, args: {} },
      { query: api.apiKeys.listUserApiKeys, args: {} },
      { query: api.dataExport.getLatestExport, args: {} }
    );
    return queries;
  }
  const folderId = folderIdForPath(url.pathname);
  const view = folderId ? "all" : libraryViewForPath(url.pathname);
  if (!view) {
    return queries;
  }
  queries.push({ query: api.card.vaultSetup.getVaultSetup, args: {} });
  if (folderId) {
    queries.push({ query: api.folders.getFolder, args: { folderId } });
  }
  const manualFolder =
    folderId !== null &&
    folders?.some(({ _id, kind }) => _id === folderId && kind !== "smart");
  const cardsArgs =
    folderId && !manualFolder
      ? null
      : initialCardsSearchQueryArgs(
          view,
          parseSearchUrlState(url.searchParams)
        );
  if (cardsArgs) {
    queries.push({
      query: api.cards.searchCardsPaginated,
      // The first page exactly as the cached usePaginatedQuery
      // (convex-helpers) asks for it; its page id is always 0.
      args: {
        ...cardsArgs,
        ...(folderId ? { folderId } : {}),
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
