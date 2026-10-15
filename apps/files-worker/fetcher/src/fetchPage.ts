import {
  RedirectError,
  readBodyWithLimit,
  SsrfError,
  safeFetch,
} from "../../../../packages/convex/linkMetadata/ssrf";
import { buildSelectorResultsFromHtml } from "../../../../packages/convex/linkMetadata/staticHtml";
import type { FetchAssetDeps } from "./fetchAsset";
import type {
  FetcherPageFailureReason,
  FetcherPageRequest,
  FetcherPageResponse,
} from "./protocol";

// The same as files-protocol's FILES_LINK_PAGE_* and FILES_SCRAPE_LIMITS,
// which this image does not bundle.
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_URL_LENGTH = 4096;
const MAX_SELECTORS = 128;
const MAX_SELECTOR_CHARS = 512;
const MAX_CONTENT_TYPE_LENGTH = 255;

// A page that asks not to be stored, or only by the one browser that asked.
const UNCACHEABLE = /(?:^|[\s,])(?:no-store|private)(?:$|[\s,=])/i;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const parseFetcherPageRequest = (
  value: unknown
): FetcherPageRequest | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { selectors, url } = value as Record<string, unknown>;
  if (
    typeof url !== "string" ||
    !url ||
    url.length > MAX_URL_LENGTH ||
    !Array.isArray(selectors) ||
    selectors.length === 0 ||
    selectors.length > MAX_SELECTORS ||
    selectors.some(
      (selector) =>
        typeof selector !== "string" ||
        !selector ||
        selector.length > MAX_SELECTOR_CHARS
    )
  ) {
    return null;
  }
  return { selectors: selectors as string[], url };
};

const CHARSET_IN_CONTENT_TYPE = /charset\s*=\s*["']?([^\s"';]+)/i;
const CHARSET_IN_META = /<meta\b[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i;
// Browsers look for a <meta> charset in the first 1024 bytes only.
const META_PRESCAN_BYTES = 1024;

const decoderFor = (label: string | undefined): TextDecoder | null => {
  if (!label) {
    return null;
  }
  try {
    const decoder = new TextDecoder(label.trim());
    // A page cannot declare UTF-16 in its own ASCII-compatible bytes; HTML
    // treats such a <meta> as UTF-8.
    return decoder.encoding.startsWith("utf-16")
      ? new TextDecoder("utf-8")
      : decoder;
  } catch {
    return null;
  }
};

/**
 * Decode a page the way a browser picks its encoding: a byte order mark,
 * then the Content-Type charset, then a <meta> charset near the top, then
 * UTF-8.
 */
export const decodeHtml = (
  bytes: Uint8Array,
  contentType: string | null
): { charset: string; html: string } => {
  let decoder: TextDecoder | null = null;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    decoder = new TextDecoder("utf-8");
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    decoder = new TextDecoder("utf-16be");
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    decoder = new TextDecoder("utf-16le");
  }
  decoder ??= decoderFor(contentType?.match(CHARSET_IN_CONTENT_TYPE)?.[1]);
  decoder ??= decoderFor(
    new TextDecoder("latin1")
      .decode(bytes.subarray(0, META_PRESCAN_BYTES))
      .match(CHARSET_IN_META)?.[1]
  );
  decoder ??= new TextDecoder("utf-8");
  return { charset: decoder.encoding, html: decoder.decode(bytes) };
};

export type FetchPageOutcome =
  | ({ ok: true } & FetcherPageResponse)
  | {
      contentType?: string;
      ok: false;
      reason: FetcherPageFailureReason;
      status?: number;
    };

const fail = (
  reason: FetcherPageFailureReason,
  extra: { contentType?: string; status?: number } = {}
): FetchPageOutcome => ({ ok: false, reason, ...extra });

export const fetchLinkPage = async (
  request: FetcherPageRequest,
  { pinnedFetch, resolveDns }: FetchAssetDeps
): Promise<FetchPageOutcome> => {
  let finalUrl: string;
  let response: Response;
  try {
    ({ finalUrl, response } = await safeFetch(
      request.url,
      resolveDns,
      {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": USER_AGENT,
        },
      },
      pinnedFetch
    ));
  } catch (error) {
    return fail(
      error instanceof SsrfError && !(error instanceof RedirectError)
        ? "blocked_url"
        : "fetch_failed"
    );
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return fail("http_error", { status: response.status });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    await response.body?.cancel().catch(() => undefined);
    return fail("unsupported_type", {
      contentType: contentType.slice(0, MAX_CONTENT_TYPE_LENGTH),
    });
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PAGE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return fail("too_large");
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(response, MAX_PAGE_BYTES);
  } catch (error) {
    return error instanceof Error && error.message.startsWith("body_too_large")
      ? fail("too_large")
      : fail("fetch_failed");
  }

  const { charset, html } = decodeHtml(bytes, contentType);
  return {
    cacheable: !UNCACHEABLE.test(response.headers.get("cache-control") ?? ""),
    charset,
    html,
    ok: true,
    pageUrl: finalUrl,
    selectors: buildSelectorResultsFromHtml(
      html,
      request.selectors.map((selector) => ({ selector }))
    ),
  };
};
