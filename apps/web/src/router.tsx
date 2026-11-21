import { createRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { SegmentErrorScreen } from "@/components/feedback/SegmentErrorScreen";
import { parseSearch, stringifySearch } from "@/lib/routerSearch";
import { routeTree } from "./routeTree.gen";

// A page that fails renders inside the app shell, so the sidebar still works.
function PageError({ error }: ErrorComponentProps) {
  return <SegmentErrorScreen boundary="app" error={error as Error} />;
}

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultErrorComponent: PageError,
    parseSearch,
    stringifySearch,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
