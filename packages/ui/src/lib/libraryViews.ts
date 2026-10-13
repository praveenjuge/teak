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
  all: "All cards",
  favorites: "Favorites",
  archive: "Archive",
  trash: "Trash",
};

/** The view a pathname shows, or null outside the library (settings). */
export function libraryViewForPath(
  pathname: string | null | undefined
): LibraryView | null {
  if (!pathname) {
    return null;
  }
  // Trim trailing slashes without a regex: a long run of "/" in a pasted URL
  // must not cost more than one pass.
  let end = pathname.length;
  while (end > 1 && pathname[end - 1] === "/") {
    end -= 1;
  }
  const path = pathname.slice(0, end);
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
 * that view, or back to All when it is already open.
 */
export const quickCommandTarget = (
  command: Exclude<LibraryView, "all">,
  current: LibraryView
): LibraryView => (command === current ? "all" : command);
