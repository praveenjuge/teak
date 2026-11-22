// Static assets answer before the Worker runs, so a request under /assets
// that reaches it names a file this deploy doesn't have, such as a chunk an
// open tab asks for after a deploy. A plain 404 is cheap and never cached,
// and client.tsx reloads the page when a chunk fails to load.
const ASSETS_PREFIX = "/assets/";

/** The answer for a missing `/assets` file, or null for any other request. */
export function missingAssetResponse(request: Request): Response | null {
  if (!new URL(request.url).pathname.startsWith(ASSETS_PREFIX)) {
    return null;
  }
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
