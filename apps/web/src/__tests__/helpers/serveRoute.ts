import { AppRouteRouteModule } from "next/dist/server/route-modules/app-route/module.js";
import { NextRequest } from "next/server";

// Serves a route handler the way Next does, so request-time APIs such as
// `cookies()` and `connection()` work. Needs Next's AsyncLocalStorage global,
// preloaded by the `test` script.
export function serveRoute(userland: unknown, pathname: string) {
  const module = new AppRouteRouteModule({
    userland: () => userland,
    definition: {
      kind: "APP_ROUTE",
      page: `${pathname}/route`,
      pathname,
      filename: "route",
      bundlePath: `app${pathname}/route`,
    },
    distDir: ".next",
    relativeProjectDir: "",
    resolvedPagePath: "",
    nextConfigOutput: undefined,
  } as never);
  return (url: string, headers?: HeadersInit) =>
    module.handle(new NextRequest(url, { headers }), {
      renderOpts: { experimental: {}, supportsDynamicResponse: true },
      sharedContext: { buildId: "test" },
    } as never);
}
