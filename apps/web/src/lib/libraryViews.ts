import type { TeakTranslator } from "@teak/i18n";
import { trimTrailingSlashes } from "./routePath";

export type LibraryView = "all" | "favorites" | "archive" | "trash";

export const LIBRARY_VIEWS: readonly LibraryView[] = [
  "all",
  "favorites",
  "archive",
  "trash",
];

export const LIBRARY_VIEW_PATHS: Record<LibraryView, string> = {
  all: "/",
  favorites: "/favorites",
  archive: "/archive",
  trash: "/trash",
};

export const FOCUS_COMPOSER_PARAM = "compose";

export interface GoToViewOptions {
  focusComposer?: boolean;
}

export const libraryViewHref = (
  view: LibraryView,
  { focusComposer = false }: GoToViewOptions = {}
): string =>
  focusComposer
    ? `${LIBRARY_VIEW_PATHS[view]}?${FOCUS_COMPOSER_PARAM}=1`
    : LIBRARY_VIEW_PATHS[view];

export type LibraryViewsTranslator = TeakTranslator<"lib.libraryViews">;

export const libraryViewLabel = (
  view: LibraryView,
  t: LibraryViewsTranslator
) => t(`labels.${view}`);

export const libraryViewSearchPlaceholder = (
  view: LibraryView,
  t: LibraryViewsTranslator
) => t(`searchPlaceholders.${view}`);

export function libraryViewForPath(
  pathname: string | null | undefined
): LibraryView | null {
  if (!pathname) {
    return null;
  }
  const path = trimTrailingSlashes(pathname);
  for (const view of LIBRARY_VIEWS) {
    if (LIBRARY_VIEW_PATHS[view] === path) {
      return view;
    }
  }
  return null;
}

export const libraryViewFlags = (view: LibraryView) => ({
  showArchivedOnly: view === "archive",
  showFavoritesOnly: view === "favorites",
  showTrashOnly: view === "trash",
});

export const quickCommandTarget = (
  command: Exclude<LibraryView, "all">,
  current: LibraryView
): LibraryView => (command === current ? "all" : command);
