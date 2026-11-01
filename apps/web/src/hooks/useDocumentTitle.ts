import { useLayoutEffect } from "react";

/** The tab title as the root layout writes it: `Name · Teak`. */
export const documentTitle = (name: string) => `${name} · Teak`;

/**
 * Names the tab after what the page shows once it has loaded, and again
 * when it changes (a renamed folder), so the browser's tab and the route
 * announcer, which reads the title, never keep a generic or stale name.
 * Null leaves the title the route's metadata set.
 *
 * On a client-side navigation the route's metadata ("Folder") can arrive
 * after the name is already known, so the title is held while the page is
 * shown: a later write to `<head>` is put back. A layout effect lets go
 * in the same commit that leaves the page, before the next route's title.
 */
export function useDocumentTitle(name: string | null | undefined) {
  useLayoutEffect(() => {
    if (!name) {
      return;
    }
    const title = documentTitle(name);
    const apply = () => {
      if (document.title !== title) {
        document.title = title;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [name]);
}
