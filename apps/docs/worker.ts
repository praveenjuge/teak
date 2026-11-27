import { negotiateMarkdown, withVaryAccept } from "./lib/markdownNegotiation";

// Runs before the static assets (runWorkerFirst) so Markdown clients get
// content negotiation; every other request goes straight to the assets.
// HTML replies vary on Accept because Markdown ones do.
export default {
  async fetch(
    request: Request,
    env: { ASSETS: { fetch: (input: Request | URL) => Promise<Response> } }
  ): Promise<Response> {
    const negotiated = await negotiateMarkdown(request, env.ASSETS);
    if (negotiated) {
      return negotiated;
    }
    const response = await env.ASSETS.fetch(request);
    if (response.headers.get("Content-Type")?.includes("text/html")) {
      return withVaryAccept(response);
    }
    return response;
  },
};
