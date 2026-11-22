import { useLayoutEffect } from "react";
import { pageTitle } from "@/lib/pageTitle";

/**
 * Names the tab after something only the page knows once it has loaded (a
 * folder's name, a link that's gone), and again when it changes, so the
 * browser's tab and the route announcer never keep a generic or stale name.
 * Null leaves the title the route's `head` set.
 *
 * On a client-side navigation the route's `head` ("Folder") can be written
 * after the name is already known, so the title is held while the page is
 * shown: a later write to `<head>` is put back. A layout effect lets go
 * in the same commit that leaves the page, before the next route's title.
 */
export function useDocumentTitle(name: string | null | undefined) {
  useLayoutEffect(() => {
    if (!name) {
      return;
    }
    const title = pageTitle(name);
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
