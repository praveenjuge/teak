import type { TeakTranslator } from "@teak/i18n";
import { englishTranslator } from "./englishTranslators";

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

const englishLibraryViews: LibraryViewsTranslator =
  englishTranslator("lib.libraryViews");

export const libraryViewLabel = (
  view: LibraryView,
  t: LibraryViewsTranslator = englishLibraryViews
) => t(`labels.${view}`);

export const libraryViewSearchPlaceholder = (
  view: LibraryView,
  t: LibraryViewsTranslator = englishLibraryViews
) => t(`searchPlaceholders.${view}`);

/** English view names. Prefer libraryViewLabel, which translates. */
export const LIBRARY_VIEW_LABELS: Record<LibraryView, string> = {
  all: libraryViewLabel("all"),
  favorites: libraryViewLabel("favorites"),
  archive: libraryViewLabel("archive"),
  trash: libraryViewLabel("trash"),
};

/** English placeholders. Prefer libraryViewSearchPlaceholder. */
export const LIBRARY_VIEW_SEARCH_PLACEHOLDERS: Record<LibraryView, string> = {
  all: libraryViewSearchPlaceholder("all"),
  favorites: libraryViewSearchPlaceholder("favorites"),
  archive: libraryViewSearchPlaceholder("archive"),
  trash: libraryViewSearchPlaceholder("trash"),
};

function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === "/") {
    end -= 1;
  }
  return path.slice(0, end);
}

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
