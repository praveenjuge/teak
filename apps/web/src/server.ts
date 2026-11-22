import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { proxyAnalytics } from "./server/analyticsProxy";
import { reportServerError } from "./server/errorReport";
import { missingAssetResponse } from "./server/missingAsset";
import { createNonce, withSecurityHeaders } from "./server/securityHeaders";

const handle = createStartHandler(defaultStreamHandler);

export default createServerEntry({
  fetch: async (request) => {
    try {
      const missingAsset = missingAssetResponse(request);
      if (missingAsset) {
        return withSecurityHeaders(missingAsset);
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
