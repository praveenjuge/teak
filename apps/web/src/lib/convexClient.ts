import { api } from "@teak/convex";
import { ConvexReactClient } from "convex/react";
import { firstLoadQueries } from "./firstLoadQueries";
import { getConvexUrl } from "./public-env";

// Never closed: React replays effects in development and hides routes with
// Activity, and closing a client that mounted auth or subscription effects
// still use would break them. Convex raises its unsaved-changes prompt for
// any request in flight, reads included. The first token comes fresh from the
// page load (AuthKit's eagerAuth), so initialAuthTokenReuse keeps it until it
// nears expiry instead of fetching another at once, which would make the
// server run every query a second time; the option is experimental in Convex.
export const convex = new ConvexReactClient(getConvexUrl(), {
  expectAuth: true,
  initialAuthTokenReuse: true,
  unsavedChangesWarning: false,
});

const FIRST_LOAD_QUERY_HOLD_MS = 30_000;
// As long as the router keeps a preloaded route (its default preloadStaleTime).
const INTENT_QUERY_HOLD_MS = 30_000;

// Starts the page's own queries as the client is created, before React renders.
if (typeof window !== "undefined") {
  for (const { query, args } of firstLoadQueries(
    new URL(window.location.href)
  )) {
    convex.prewarmQuery({
      query,
      args,
      extendSubscriptionFor: FIRST_LOAD_QUERY_HOLD_MS,
    });
  }
}

/** Starts the queries a page loads first, before it renders. */
export function prewarmRouteQueries(href: string) {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) {
    return;
  }
  for (const { query, args } of firstLoadQueries(url, {
    folders: loadedFolders(),
  })) {
    convex.prewarmQuery({
      query,
      args,
      extendSubscriptionFor: INTENT_QUERY_HOLD_MS,
    });
  }
}

function loadedFolders() {
  try {
    return convex.watchQuery(api.folders.listFolders, {}).localQueryResult();
  } catch {
    return [];
  }
}

/**
 * A page route's loader. The router runs it when someone heads for a link
 * (`defaultPreload: "intent"`) and when they navigate, so the page's first
 * queries are already on their way. A page load's server render has run
 * them already (the layout's seeds).
 */
export function prewarmPageLoader({
  location,
}: {
  location: { href: string };
}) {
  if (typeof window !== "undefined") {
    prewarmRouteQueries(location.href);
  }
}
