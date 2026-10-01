/**
 * Content negotiation for Markdown-aware agents.
 *
 * The site builds a Markdown mirror next to most pages (for example
 * /docs/ai-agents.md for /docs/ai-agents, /index.md for /). The Routing
 * Middleware in middleware.ts uses these helpers to serve the mirror when
 * the client prefers Markdown, so agents get clean text from the same URL
 * that serves HTML to browsers.
 */

interface AcceptEntry {
  mediaRange: string;
  order: number;
  quality: number;
  specificity: number;
}

/** Parses an Accept header into media ranges, most preferred first. */
export function parseAcceptHeader(header: string): AcceptEntry[] {
  return header
    .split(",")
    .map((part, order) => {
      const [mediaRange, ...params] = part.trim().split(";");
      let quality = 1;

      for (const param of params) {
        const [name, value] = param.trim().split("=");
        if (name.trim().toLowerCase() === "q") {
          // RFC 9110 qvalue grammar: 0-1 with at most three decimal digits.
          // Anything else is not a valid quality value and rejects the range.
          quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(
            (value ?? "").trim()
          )
            ? Number.parseFloat((value ?? "").trim())
            : 0;
        }
      }

      const type = mediaRange.trim().toLowerCase();
      let specificity = 2;
      if (type === "*/*") {
        specificity = 0;
      } else if (type.includes("*")) {
        specificity = 1;
      }

      return { mediaRange: type, quality, specificity, order };
    })
    .filter((entry) => entry.mediaRange.length > 0)
    .sort(
      (a, b) =>
        b.quality - a.quality ||
        b.specificity - a.specificity ||
        a.order - b.order
    );
}

/**
 * Quality value a client assigned to a media type, if it mentioned it.
 * RFC 9110 12.5.1: the most specific matching range sets the quality, so an
 * explicit text/html;q=0 beats a higher-q wildcard like text/* or *\/*.
 */
export function qualityFor(
  entries: AcceptEntry[],
  mediaType: string
): number | undefined {
  const [type, subtype] = mediaType.split("/");
  let best: AcceptEntry | undefined;

  for (const entry of entries) {
    const [entryType, entrySubtype] = entry.mediaRange.split("/");
    const matches =
      (entryType === "*" || entryType === type) &&
      (entrySubtype === "*" || entrySubtype === subtype);

    if (!matches) {
      continue;
    }

    if (
      !best ||
      entry.specificity > best.specificity ||
      (entry.specificity === best.specificity &&
        (entry.quality > best.quality ||
          (entry.quality === best.quality && entry.order < best.order)))
    ) {
      best = entry;
    }
  }

  return best?.quality;
}

/** Quality value from an exact media type mention, wildcards excluded. */
function explicitQuality(
  entries: AcceptEntry[],
  mediaType: string
): number | undefined {
  for (const entry of entries) {
    if (entry.mediaRange === mediaType) {
      return entry.quality;
    }
  }

  return undefined;
}

/** Best-match quality value for HTML across the usual media ranges. */
function htmlQuality(entries: AcceptEntry[]): number {
  return (
    qualityFor(entries, "text/html") ??
    qualityFor(entries, "text/*") ??
    qualityFor(entries, "*/*") ??
    0
  );
}

/**
 * True when the client explicitly accepts Markdown and does not clearly
 * prefer HTML. Plain browser Accept headers never mention Markdown, so
 * browser traffic is unaffected. The most specific matching range wins.
 */
export function prefersMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) {
    return false;
  }

  const entries = parseAcceptHeader(acceptHeader);
  // Only an explicit text/markdown range counts. Wildcards like */* are the
  // default for plain HTTP clients and must keep receiving HTML.
  const markdownQ = explicitQuality(entries, "text/markdown") ?? 0;

  if (markdownQ <= 0) {
    return false;
  }

  return markdownQ >= htmlQuality(entries);
}

/** Pages whose built Markdown mirror is a single path segment deep. */
const MIRRORABLE_PAGE = /^\/(?:docs|changelog|reference\/operations)\/[^/]+$/;

/**
 * Markdown mirror URL for a page, or null when the page has no mirror.
 * /apps, /changelog, and /pricing intentionally have no mirror yet, so they
 * always keep serving HTML.
 */
export function markdownMirrorPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (normalized.endsWith(".md")) {
    return null;
  }

  if (normalized === "/") {
    return "/index.md";
  }

  if (normalized === "/docs") {
    return "/docs.md";
  }

  if (MIRRORABLE_PAGE.test(normalized)) {
    return `${normalized}.md`;
  }

  return null;
}

/**
 * Paths proxied to other services or owned by the platform. They never
 * serve site pages, so a Markdown request must reach them untouched.
 */
const PASSTHROUGH_PATH = /^\/(?:api|mcp|\.well-known|_vercel)(?:\/|$)/;

/** True when a path can be probed for a Markdown "not found" response. */
export function canServeMarkdownNotFound(pathname: string): boolean {
  return !PASSTHROUGH_PATH.test(pathname);
}

export type MarkdownResolution =
  | { type: "html" }
  | { type: "rewrite"; path: string }
  | { type: "not-found"; markdown: string };

type Fetcher = (input: URL, init?: RequestInit) => Promise<Response>;

/**
 * Decides how to answer a request from a client that prefers Markdown.
 *
 * - A page with a built mirror is rewritten to that mirror.
 * - A missing page (no mirror, or no HTML page either) gets the built
 *   /404.md body so agents read the recovery links instead of an HTML
 *   error page. The caller keeps the 404 status.
 * - Everything else keeps serving HTML.
 *
 * Probes use HEAD requests with an HTML Accept header so they never
 * re-enter the Markdown branch.
 */
export async function resolveMarkdownRequest(
  request: Request,
  fetchImpl: Fetcher = fetch
): Promise<MarkdownResolution> {
  if (
    (request.method !== "GET" && request.method !== "HEAD") ||
    !prefersMarkdown(request.headers.get("accept"))
  ) {
    return { type: "html" };
  }

  const url = new URL(request.url);

  if (!canServeMarkdownNotFound(url.pathname)) {
    return { type: "html" };
  }

  const exists = async (target: URL) => {
    const response = await fetchImpl(target, {
      method: "HEAD",
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    return response.status !== 404;
  };

  // A failed probe must never break a page that would otherwise load, so any
  // network error degrades to the normal HTML response.
  try {
    const mirrorPath = markdownMirrorPath(url.pathname);

    if (mirrorPath && (await exists(new URL(mirrorPath, request.url)))) {
      return { type: "rewrite", path: mirrorPath };
    }

    // No mirror: the page may still exist as HTML (for example /pricing, or a
    // page whose mirror was not built), and must keep serving it.
    if (await exists(url)) {
      return { type: "html" };
    }

    const notFound = await fetchImpl(new URL("/404.md", request.url), {
      headers: { accept: "text/markdown" },
    });

    if (!notFound.ok) {
      return { type: "html" };
    }

    const markdown = await notFound.text();

    return markdown.trim() ? { type: "not-found", markdown } : { type: "html" };
  } catch {
    return { type: "html" };
  }
}

/** 404 response carrying the Markdown error page. */
export function markdownNotFoundResponse(
  markdown: string,
  method: string,
): Response {
  const body = new TextEncoder().encode(markdown);

  return new Response(method === "HEAD" ? null : body, {
    status: 404,
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Length": String(body.byteLength),
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept",
    },
  });
}
