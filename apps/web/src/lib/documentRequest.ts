/**
 * Whether the browser is loading the page as a document (asking for HTML),
 * rather than the Next.js router fetching server components for a page it
 * already shows, as it does to refresh after a server action sets a cookie.
 */
export function isDocumentRequest(requestHeaders: Pick<Headers, "get">) {
  return requestHeaders.get("accept")?.includes("text/html") ?? false;
}
