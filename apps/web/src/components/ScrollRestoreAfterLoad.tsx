import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { scrollWhenReachable } from "@/lib/scrollWhenReachable";

interface HistoryLocation {
  hash: string;
  href: string;
  state: { __TSR_key?: string };
}

interface NavigationEvent {
  fromLocation?: HistoryLocation;
  toLocation: HistoryLocation;
}

/** The part of the router this needs, so tests can drive it. */
export interface ScrollRestoreRouter {
  subscribe: (
    eventType: "onBeforeLoad" | "onRendered",
    listener: (event: NavigationEvent) => void
  ) => () => void;
}

// The router's own key for a history entry (scroll restoration's default).
const entryKey = (location: HistoryLocation) =>
  location.state.__TSR_key ?? location.href;

/**
 * Remembers where the window was on each history entry, and when one is
 * shown again short of that place, scrolls there once the content is tall
 * enough. Returns a function that stops listening.
 */
export function restoreScrollAfterLoad(router: ScrollRestoreRouter) {
  const positions = new Map<string, { left: number; top: number }>();
  let stopWaiting: () => void = () => undefined;
  const unsubscribers = [
    router.subscribe("onBeforeLoad", ({ fromLocation }) => {
      stopWaiting();
      if (fromLocation) {
        positions.set(entryKey(fromLocation), {
          left: window.scrollX,
          top: window.scrollY,
        });
      }
    }),
    router.subscribe("onRendered", ({ toLocation }) => {
      stopWaiting();
      const saved = positions.get(entryKey(toLocation));
      // A new entry has no saved place, and a hash scrolls to its target.
      if (!saved || toLocation.hash) {
        return;
      }
      stopWaiting = scrollWhenReachable(saved.top, saved.left);
    }),
  ];
  return () => {
    stopWaiting();
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

/**
 * Finishes the router's scroll restoration on pages that load their content
 * after they render. Going Back to the library from Settings rendered its
 * loading frame first, so the router's restore was clamped to the top and the
 * place in the grid was lost.
 */
export function ScrollRestoreAfterLoad() {
  const router = useRouter();
  useEffect(() => restoreScrollAfterLoad(router), [router]);
  return null;
}
