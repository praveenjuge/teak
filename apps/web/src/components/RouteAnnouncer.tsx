import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

// Long enough for the new page's head and any title set in an effect to land.
const SETTLE_MS = 100;

/**
 * Tells screen readers which page a client-side navigation opened, the way a
 * full page load would: it reads the tab title once the new page has
 * rendered, falling back to its first heading, then to the path. A search or
 * hash change on the same page isn't announced.
 */
export function RouteAnnouncer() {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    // The path last announced, kept here: the router's own `pathChanged`
    // compares with the last resolved location, which a quick run of
    // replaced URLs (typing in a search field) can leave behind.
    let announcedPath = router.state.location.pathname;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const announce = ({ toLocation }: { toLocation: { pathname: string } }) => {
      if (toLocation.pathname === announcedPath) {
        return;
      }
      announcedPath = toLocation.pathname;
      clearTimeout(timer);
      timer = setTimeout(() => {
        setAnnouncement(
          document.title ||
            document.querySelector("main h1, h1")?.textContent?.trim() ||
            toLocation.pathname
        );
      }, SETTLE_MS);
    };
    const unsubscribers = [
      router.subscribe("onResolved", announce),
      router.subscribe("onRendered", announce),
    ];
    return () => {
      clearTimeout(timer);
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [router]);
  return (
    <p aria-atomic="true" aria-live="assertive" className="sr-only">
      {announcement}
    </p>
  );
}
