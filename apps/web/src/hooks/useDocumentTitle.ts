import { useEffect } from "react";

/** The tab title as the root layout writes it: `Name · Teak`. */
export const documentTitle = (name: string) => `${name} · Teak`;

/**
 * Names the tab after what the page shows once it has loaded, and again
 * when it changes (a renamed folder), so the browser's tab and the route
 * announcer, which reads the title, never keep a generic or stale name.
 * Null leaves the title the route's metadata set.
 */
export function useDocumentTitle(name: string | null | undefined) {
  useEffect(() => {
    if (name) {
      document.title = documentTitle(name);
    }
  }, [name]);
}
