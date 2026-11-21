import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

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
    let frame = 0;
    const unsubscribe = router.subscribe("onRendered", (event) => {
      if (!(event.fromLocation && event.pathChanged)) {
        return;
      }
      cancelAnimationFrame(frame);
      // A frame later, the route's head and any page title set in an effect
      // have landed.
      frame = requestAnimationFrame(() => {
        setAnnouncement(
          document.title ||
            document.querySelector("main h1, h1")?.textContent?.trim() ||
            event.toLocation.pathname
        );
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [router]);
  return (
    <p aria-atomic="true" aria-live="assertive" className="sr-only">
      {announcement}
    </p>
  );
}
