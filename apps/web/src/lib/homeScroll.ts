interface NavigationEntryState {
  currentEntry?: { getState: () => unknown };
  updateCurrentEntry: (options: { state: unknown }) => void;
}

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
