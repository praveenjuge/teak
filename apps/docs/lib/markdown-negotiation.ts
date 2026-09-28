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
