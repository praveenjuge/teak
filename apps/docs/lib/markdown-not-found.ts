import { markdownMirrorPath, prefersMarkdown } from "./markdown-negotiation";

export type MarkdownResolution =
  | { kind: "rewrite"; path: string }
  | { kind: "not-found"; response: Response }
  | null;

type Probe = (url: URL) => Promise<number | null>;

/** Markdown body for an unknown path, with links agents can follow next. */
export function markdownNotFoundBody(pathname: string): string {
  return [
    "# 404: Page not found",
    "",
    `Teak has no page at \`${pathname}\`.`,
    "",
    "Start from one of these instead:",
    "",
    "- [Documentation](/docs.md)",
    "- [Sitemap](/sitemap.xml)",
    "- [llms.txt](/llms.txt)",
    "",
  ].join("\n");
}

/** A real 404 response whose body is Markdown, for Markdown-preferring clients. */
export function markdownNotFoundResponse(pathname: string): Response {
  return new Response(markdownNotFoundBody(pathname), {
    status: 404,
    headers: {
      "cache-control": "public, max-age=0, must-revalidate",
      "content-type": "text/markdown; charset=utf-8",
      vary: "Accept",
    },
  });
}

/**
 * Decide how to answer a request that asks for Markdown. Returns null when
 * the request should continue untouched. A probe that fails or returns
 * anything other than 404 never blocks a page, so an outage cannot turn a
 * working URL into an error.
 */
export async function resolveMarkdownRequest(
  request: Request,
  probe: Probe
): Promise<MarkdownResolution> {
  // Only safe methods are probed or rewritten: a POST must reach its handler.
  const safeMethod = request.method === "GET" || request.method === "HEAD";

  if (!(safeMethod && prefersMarkdown(request.headers.get("accept")))) {
    return null;
  }

  const url = new URL(request.url);
  const mirrorPath = markdownMirrorPath(url.pathname);
  const target = new URL(mirrorPath ?? url.pathname, url);

  if ((await probe(target)) === 404) {
    return {
      kind: "not-found",
      response: markdownNotFoundResponse(url.pathname),
    };
  }

  return mirrorPath ? { kind: "rewrite", path: mirrorPath } : null;
}
