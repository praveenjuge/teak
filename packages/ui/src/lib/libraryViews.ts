/** The library's routed views, each its own page in the sidebar. */
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

export const LIBRARY_VIEW_LABELS: Record<LibraryView, string> = {
  all: "Everything",
  favorites: "Favorites",
  archive: "Archive",
  trash: "Trash",
};

/** Each view's search field placeholder. */
export const LIBRARY_VIEW_SEARCH_PLACEHOLDERS: Record<LibraryView, string> = {
  all: "Search everything",
  favorites: "Search favorites",
  archive: "Search archive",
  trash: "Search Trash",
};

/** `path` without trailing slashes, keeping a lone root `/`, in one pass. */
function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === "/") {
    end -= 1;
  }
  return path.slice(0, end);
}

/** The view a pathname shows, or null outside the library (settings). */
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

/** The search flags a view stands for. */
export const libraryViewFlags = (view: LibraryView) => ({
  showArchivedOnly: view === "archive",
  showFavoritesOnly: view === "favorites",
  showTrashOnly: view === "trash",
});

/**
 * Where a quick command typed in search (`fav`, `trash`, `archive`) goes:
 * that view, or back to Everything when it is already open.
 */
export const quickCommandTarget = (
  command: Exclude<LibraryView, "all">,
  current: LibraryView
): LibraryView => (command === current ? "all" : command);
