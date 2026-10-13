interface NavigationEntryState {
  currentEntry?: { getState: () => unknown };
  updateCurrentEntry: (options: { state: unknown }) => void;
}

/**
 * Saves the library's scroll position on the current history entry, so
 * Settings' Back link (and the browser's) can return to the same spot.
 */
export function rememberHomeScroll() {
  const navigation = (window as Window & { navigation?: NavigationEntryState })
    .navigation;
  const state = navigation?.currentEntry?.getState();
  navigation?.updateCurrentEntry({
    state: {
      ...(typeof state === "object" && state ? state : {}),
      __teakHomeScrollY: window.scrollY,
    },
  });
}
