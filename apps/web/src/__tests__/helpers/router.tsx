import {
  type AnyRouter,
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { parseSearch, stringifySearch } from "@/lib/routerSearch";

/**
 * A real TanStack router without the app's routes, for components that read
 * the location, render links or navigate. It starts at `url` in memory, or,
 * with `browser`, follows the window's URL and history. Search params read
 * and write as in the app.
 */
export function testRouter(url = "/", { browser = false } = {}) {
  return createRouter({
    routeTree: createRootRoute(),
    history: browser
      ? createBrowserHistory()
      : createMemoryHistory({ initialEntries: [url] }),
    parseSearch,
    stringifySearch,
  });
}

/** Renders `children` inside `router`, or a fresh one at `/`. */
export function TestRouter({
  children,
  router,
}: {
  children: ReactNode;
  router?: AnyRouter;
}) {
  const [fallback] = useState(testRouter);
  return (
    <RouterContextProvider router={router ?? fallback}>
      {children}
    </RouterContextProvider>
  );
}
