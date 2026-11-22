import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { proxyAnalytics } from "./server/analyticsProxy";
import { reportServerError } from "./server/errorReport";
import { createNonce, withSecurityHeaders } from "./server/securityHeaders";

const handle = createStartHandler(defaultStreamHandler);

// Static assets answer before the Worker runs, so a request under /assets
// that reaches it names a file this deploy doesn't have, such as a chunk an
// open tab asks for after a deploy. A plain 404 is cheap and never cached,
// and client.tsx reloads the page when a chunk fails to load.
const ASSETS_PREFIX = "/assets/";

const missingAsset = () =>
  new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });

export default createServerEntry({
  fetch: async (request) => {
    try {
      if (new URL(request.url).pathname.startsWith(ASSETS_PREFIX)) {
        return withSecurityHeaders(missingAsset());
      }
      // The PostHog proxy answers before the app runs, so it never sits
      // behind sign-in. Its replies keep PostHog's caching and gain only the
      // security headers they lack.
      const analytics = await proxyAnalytics(request);
      if (analytics) {
        return withSecurityHeaders(analytics);
      }
      const nonce = createNonce();
      const response = await handle(request, {
        context: { nonce },
        // Cloudflare turns a page's preload and preconnect `Link` headers
        // into 103 Early Hints for the next visit, so the stylesheet, font
        // and files host start loading before the page is rendered.
        responseLinkHeader: {
          filter: ({ hint }) =>
            hint.rel === "preload" || hint.rel === "preconnect",
        },
      });
      return withSecurityHeaders(response, nonce);
    } catch (error) {
      reportServerError(error, request);
      throw error;
    }
  },
});
