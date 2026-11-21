/**
 * Whether the browser is loading the page as a document (asking for HTML),
 * rather than the router calling a server function for a page it already
 * shows.
 */
export function isDocumentRequest(requestHeaders: Pick<Headers, "get">) {
  return requestHeaders.get("accept")?.includes("text/html") ?? false;
}
