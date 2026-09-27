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
        if (name === "q") {
          const parsed = Number.parseFloat(value ?? "");
          quality = Number.isNaN(parsed) ? 0 : parsed;
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

/** Quality value a client assigned to a media type, if it mentioned it. */
export function qualityFor(
  entries: AcceptEntry[],
  mediaType: string
): number | undefined {
  const [type, subtype] = mediaType.split("/");

  for (const entry of entries) {
    const [entryType, entrySubtype] = entry.mediaRange.split("/");
    const matches =
      (entryType === "*" || entryType === type) &&
      (entrySubtype === "*" || entrySubtype === subtype);

    if (matches) {
      return entry.quality;
    }
  }

  return undefined;
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
