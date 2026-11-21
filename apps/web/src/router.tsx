import { createRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";
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
    // On the server, the CSP nonce server.ts made for this request; the
    // browser reads it back from the page.
    ssr: { nonce: getGlobalStartContext()?.nonce },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

declare module "@tanstack/react-start" {
  interface Register {
    // What server.ts hands Start with every request.
    server: { requestContext: { nonce: string } };
  }
}
