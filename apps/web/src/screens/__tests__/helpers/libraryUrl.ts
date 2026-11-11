import { parseSearchUrlState } from "../../../lib/searchUrlState";

/**
 * What LibraryScreen hands CardsScreen from the page's URL, for a test that
 * doesn't watch it: an empty search, and handlers that do nothing.
 */
export const libraryUrlProps = () => ({
  onAddCardsToFolder: () => undefined,
  onAddToFolderDone: () => undefined,
  onNavigateView: () => undefined,
  onOpenFolder: () => undefined,
  onSearchUrlStateChange: () => undefined,
  onSwitchCard: () => undefined,
  onVisualFiltersChange: () => undefined,
  searchUrlState: parseSearchUrlState(new URLSearchParams()),
});
