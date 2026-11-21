import { expect, test } from "bun:test";
// Start's own request context: the handler runs getRouter() inside it, with
// the context server.ts passed (`handle(request, { context: { nonce } })`).
import { runWithStartContext } from "@tanstack/start-storage-context";

// The route tree it loads creates the Convex client.
process.env.VITE_PUBLIC_CONVEX_URL ??= "https://fixture.convex.cloud";

const { getRouter } = await import("../router");

test("the router takes the request's CSP nonce from Start's context", () => {
  const router = runWithStartContext(
    {
      contextAfterGlobalMiddlewares: { nonce: "nonce-from-server-ts" },
      getRouter,
      handlerType: "router",
      request: new Request("http://localhost:3000/"),
      startOptions: {},
    },
    () => getRouter()
  );
  // Start stamps this on every inline script; without it the nonce-only CSP
  // blocks hydration.
  expect(router.options.ssr?.nonce).toBe("nonce-from-server-ts");
});
