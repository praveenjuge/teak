"use node";

import dns from "node:dns/promises";
import { parseHTML } from "linkedom";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";

type LinkPreviewSource = "convex_node_fetch";

interface LinkPreviewDebugEntry {
  selector: string;
  value?: string;
}

interface LinkPreviewMetadata {
  source: LinkPreviewSource;
  status: "success" | "error";
  fetchedAt: number;
  url: string;
  finalUrl?: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  faviconUrl?: string;
  siteName?: string;
  author?: string;
  publisher?: string;
  publishedAt?: string;
  screenshotStorageId?: Id<"_storage">;
  screenshotUpdatedAt?: number;
  error?: {
    type?: string;
    message?: string;
    details?: any;
  };
  raw?: LinkPreviewDebugEntry[];
}

type SelectorSource = {
  selector: string;
  attribute: "content" | "href" | "text";
};

const LINK_PREVIEW_SOURCE: LinkPreviewSource = "convex_node_fetch";
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20000;
const MAX_BYTES = 2_000_000; // 2MB limit for HTML downloads
const USER_AGENT =
  process.env.LINK_PREVIEW_USER_AGENT ?? "TeakPreviewBot/1.0 (+https://teak.so/link-preview)";

const TITLE_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:title']", attribute: "content" },
  { selector: "meta[name='og:title']", attribute: "content" },
  { selector: "meta[name='twitter:title']", attribute: "content" },
  { selector: "meta[property='twitter:title']", attribute: "content" },
  { selector: "meta[name='title']", attribute: "content" },
  { selector: "head > title", attribute: "text" },
];

const DESCRIPTION_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:description']", attribute: "content" },
  { selector: "meta[name='og:description']", attribute: "content" },
  { selector: "meta[name='description']", attribute: "content" },
  { selector: "meta[property='description']", attribute: "content" },
  { selector: "meta[name='twitter:description']", attribute: "content" },
  { selector: "meta[property='twitter:description']", attribute: "content" },
];

const IMAGE_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:image:secure_url']", attribute: "content" },
  { selector: "meta[property='og:image:url']", attribute: "content" },
  { selector: "meta[property='og:image']", attribute: "content" },
  { selector: "meta[name='og:image']", attribute: "content" },
  { selector: "meta[property='twitter:image']", attribute: "content" },
  { selector: "meta[name='twitter:image']", attribute: "content" },
  { selector: "meta[property='twitter:image:src']", attribute: "content" },
  { selector: "meta[name='twitter:image:src']", attribute: "content" },
  { selector: "link[rel='image_src']", attribute: "href" },
  { selector: "meta[name='msapplication-TileImage']", attribute: "content" },
];

const FAVICON_SOURCES: SelectorSource[] = [
  { selector: "link[rel='icon']", attribute: "href" },
  { selector: "link[rel='shortcut icon']", attribute: "href" },
  { selector: "link[rel='apple-touch-icon']", attribute: "href" },
  { selector: "link[rel='apple-touch-icon-precomposed']", attribute: "href" },
  { selector: "link[rel='mask-icon']", attribute: "href" },
];

const SITE_NAME_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:site_name']", attribute: "content" },
  { selector: "meta[name='og:site_name']", attribute: "content" },
  { selector: "meta[name='application-name']", attribute: "content" },
  { selector: "meta[name='publisher']", attribute: "content" },
];

const AUTHOR_SOURCES: SelectorSource[] = [
  { selector: "meta[name='author']", attribute: "content" },
  { selector: "meta[property='article:author']", attribute: "content" },
  { selector: "meta[name='byl']", attribute: "content" },
  { selector: "meta[property='book:author']", attribute: "content" },
];

const PUBLISHER_SOURCES: SelectorSource[] = [
  { selector: "meta[property='article:publisher']", attribute: "content" },
  { selector: "meta[name='publisher']", attribute: "content" },
  { selector: "meta[property='og:site_name']", attribute: "content" },
];

const PUBLISHED_TIME_SOURCES: SelectorSource[] = [
  { selector: "meta[property='article:published_time']", attribute: "content" },
  { selector: "meta[name='article:published_time']", attribute: "content" },
  { selector: "meta[name='pubdate']", attribute: "content" },
  { selector: "meta[name='publication_date']", attribute: "content" },
  { selector: "meta[name='date']", attribute: "content" },
];

const CANONICAL_SOURCES: SelectorSource[] = [
  { selector: "link[rel='canonical']", attribute: "href" },
  { selector: "meta[property='og:url']", attribute: "content" },
  { selector: "meta[name='og:url']", attribute: "content" },
];

const FINAL_URL_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:url']", attribute: "content" },
  { selector: "meta[name='og:url']", attribute: "content" },
  { selector: "meta[property='al:web:url']", attribute: "content" },
  { selector: "meta[property='twitter:url']", attribute: "content" },
  { selector: "meta[name='twitter:url']", attribute: "content" },
];

const GITHUB_SOURCES: SelectorSource[] = [
  { selector: "a[href$='/stargazers']", attribute: "text" },
  { selector: "a[href$='/network/members']", attribute: "text" },
  { selector: "a[href$='/watchers']", attribute: "text" },
  { selector: "span[itemprop='programmingLanguage']", attribute: "text" },
  { selector: "relative-time", attribute: "text" },
];

const GOODREADS_SOURCES: SelectorSource[] = [
  { selector: "meta[property='books:rating:average']", attribute: "content" },
  { selector: "meta[property='books:rating:count']", attribute: "content" },
  { selector: "meta[property='books:isbn']", attribute: "content" },
];

const AMAZON_SOURCES: SelectorSource[] = [
  { selector: "meta[property='og:price:amount']", attribute: "content" },
  { selector: "meta[property='og:price:currency']", attribute: "content" },
  { selector: "meta[name='price']", attribute: "content" },
  { selector: "#priceblock_ourprice", attribute: "text" },
  { selector: "#priceblock_dealprice", attribute: "text" },
  { selector: ".a-price .a-offscreen", attribute: "text" },
];

const IMDB_SOURCES: SelectorSource[] = [
  { selector: "meta[name='imdb:rating']", attribute: "content" },
  { selector: "meta[name='imdb:votes']", attribute: "content" },
  { selector: "meta[property='video:release_date']", attribute: "content" },
  { selector: "span[data-testid='hero-rating-bar__aggregate-rating__score']", attribute: "text" },
  { selector: "span[data-testid='title-techspec_runtime'] span", attribute: "text" },
];

const ALL_SOURCES: SelectorSource[] = [
  ...TITLE_SOURCES,
  ...DESCRIPTION_SOURCES,
  ...IMAGE_SOURCES,
  ...FAVICON_SOURCES,
  ...SITE_NAME_SOURCES,
  ...AUTHOR_SOURCES,
  ...PUBLISHER_SOURCES,
  ...PUBLISHED_TIME_SOURCES,
  ...CANONICAL_SOURCES,
  ...FINAL_URL_SOURCES,
  ...GITHUB_SOURCES,
  ...GOODREADS_SOURCES,
  ...AMAZON_SOURCES,
  ...IMDB_SOURCES,
];

const normalizeUrl = (url: string): string => {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return `https://${url}`;
  }
  return url;
};

const sanitizeText = (value: string | undefined, maxLength: number): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > maxLength) {
    return normalized.slice(0, maxLength);
  }
  return normalized;
};

const isHttpScheme = (protocol: string) => /^https?:$/i.test(protocol);

const sanitizeUrl = (
  baseUrl: string,
  value: string | undefined,
  { allowData }: { allowData?: boolean } = {}
): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^data:/i.test(trimmed)) {
    return allowData ? trimmed : undefined;
  }

  if (/^(javascript:|mailto:)/i.test(trimmed)) {
    return undefined;
  }

  try {
    const resolved = new URL(trimmed, baseUrl);
    if (!isHttpScheme(resolved.protocol)) {
      return undefined;
    }
    return resolved.toString();
  } catch {
    return undefined;
  }
};

const sanitizeImageUrl = (baseUrl: string, value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^data:/i.test(trimmed)) {
    return trimmed;
  }
  const sanitized = sanitizeUrl(baseUrl, trimmed, { allowData: true });
  if (!sanitized) {
    return undefined;
  }
  return maybeProxyAsset(sanitized);
};

const maybeProxyAsset = (url: string): string => {
  const proxyOrigin = process.env.LINK_PREVIEW_ASSET_PROXY_ORIGIN;
  if (!proxyOrigin) {
    return url;
  }
  try {
    const proxyUrl = new URL(proxyOrigin);
    proxyUrl.searchParams.set("url", url);
    return proxyUrl.toString();
  } catch {
    return url;
  }
};

const BLOCKED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isPrivateIPv4 = (address: string) => {
  const parts = address.split(".").map((segment) => Number.parseInt(segment, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  return a >= 224;
};

const isPrivateIPv6 = (address: string) => {
  const lower = address.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fe80:") ||
    lower.startsWith("::ffff:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  );
};

const isBlockedAddress = (address: string) => {
  if (address === "0.0.0.0" || address === "::") {
    return true;
  }
  if (isPrivateIPv4(address)) {
    return true;
  }
  if (isPrivateIPv6(address)) {
    return true;
  }
  return false;
};

const validateHostnameSafety = async (url: URL) => {
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("Blocked hostname");
  }

  let lookupResults;
  try {
    lookupResults = await dns.lookup(hostname, { all: true });
  } catch (error) {
    // DNS failures are treated as network errors later in the fetch logic
    throw Object.assign(new Error("DNS lookup failed"), { cause: error, code: "dns_error" });
  }

  for (const result of lookupResults) {
    const address = result.address;
    if (isBlockedAddress(address)) {
      throw Object.assign(new Error(`Blocked address ${address}`), { code: "blocked_address" });
    }
  }
};

const concatUint8Arrays = (chunks: Uint8Array[], totalLength: number): Uint8Array => {
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
};

const isRedirectStatus = (status: number) =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308;

interface FetchHtmlResult {
  html: string;
  finalUrl: string;
}

const fetchHtml = async (initialUrl: string): Promise<FetchHtmlResult> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let currentUrl = new URL(initialUrl);
  let redirectCount = 0;

  try {
    while (true) {
      await validateHostnameSafety(currentUrl);

      const response = await fetch(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9",
        },
        signal: controller.signal,
      });

      if (isRedirectStatus(response.status)) {
        const locationHeader = response.headers.get("location");
        if (!locationHeader) {
          throw Object.assign(new Error("Redirect missing location header"), {
            code: "redirect_error",
          });
        }

        if (redirectCount >= MAX_REDIRECTS) {
          throw Object.assign(new Error("Too many redirects"), { code: "too_many_redirects" });
        }

        const nextUrl = new URL(locationHeader, currentUrl);
        if (!isHttpScheme(nextUrl.protocol)) {
          throw Object.assign(new Error("Blocked redirect scheme"), { code: "blocked_scheme" });
        }

        currentUrl = nextUrl;
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        throw Object.assign(new Error(`HTTP ${response.status}`), {
          code: "http_error",
          status: response.status,
        });
      }

      const contentType = response.headers.get("content-type") || "";
      const isHtml =
        contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
      if (!isHtml) {
        throw Object.assign(new Error("Unsupported content type"), {
          code: "invalid_content_type",
          contentType,
        });
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw Object.assign(new Error("Empty body"), { code: "empty_body" });
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        const value = result.value;
        if (!value) {
          continue;
        }

        totalBytes += value.byteLength;
        if (totalBytes > MAX_BYTES) {
          throw Object.assign(new Error("Response too large"), { code: "response_too_large" });
        }

        chunks.push(value);
      }

      const htmlBuffer = concatUint8Arrays(chunks, totalBytes);
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const html = decoder.decode(htmlBuffer);

      return {
        html,
        finalUrl: currentUrl.toString(),
      };
    }
  } catch (error) {
    if ((error as any)?.name === "AbortError") {
      throw Object.assign(new Error("Request timed out"), { code: "timeout" });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const collectSelectorValues = (document: Document, source: SelectorSource): string[] => {
  const elements = Array.from(document.querySelectorAll(source.selector));
  const values: string[] = [];

  for (const element of elements) {
    if (source.attribute === "text") {
      const text = element.textContent;
      if (text && text.trim()) {
        values.push(text.trim());
      }
      continue;
    }

    const attributeValue = element.getAttribute(source.attribute);
    if (attributeValue && attributeValue.trim()) {
      values.push(attributeValue.trim());
    }
  }

  return values;
};

const firstFromSources = (
  document: Document,
  sources: SelectorSource[]
): string | undefined => {
  for (const source of sources) {
    const values = collectSelectorValues(document, source);
    const selected = values.find((value) => value.trim());
    if (selected) {
      return selected.trim();
    }
  }
  return undefined;
};

const pickFallbackImage = (document: Document, baseUrl: string): string | undefined => {
  const candidates = Array.from(document.querySelectorAll("img"))
    .map((img) => {
      const src = img.getAttribute("src") ?? undefined;
      const sanitized = sanitizeImageUrl(baseUrl, src ?? undefined);
      if (!sanitized) {
        return undefined;
      }

      const width = Number.parseInt(img.getAttribute("width") ?? "", 10);
      const height = Number.parseInt(img.getAttribute("height") ?? "", 10);
      const area = Number.isFinite(width) && Number.isFinite(height) ? width * height : 0;

      return {
        url: sanitized,
        area,
      };
    })
    .filter((candidate): candidate is { url: string; area: number } => Boolean(candidate));

  if (!candidates.length) {
    return undefined;
  }

  candidates.sort((a, b) => b.area - a.area);
  return candidates[0].url;
};

const buildDebugEntries = (document: Document): LinkPreviewDebugEntry[] => {
  const entries: LinkPreviewDebugEntry[] = [];
  for (const source of ALL_SOURCES.slice(0, 30)) {
    const value = firstFromSources(document, [source]);
    if (value) {
      entries.push({
        selector: source.selector,
        value: sanitizeText(value, 200),
      });
    }
  }
  return entries;
};

const parseLinkPreview = (normalizedUrl: string, html: string) => {
  const { document } = parseHTML(html);

  const title = sanitizeText(firstFromSources(document, TITLE_SOURCES), 512);
  const description = sanitizeText(firstFromSources(document, DESCRIPTION_SOURCES), 2048);
  const canonicalUrl = sanitizeUrl(normalizedUrl, firstFromSources(document, CANONICAL_SOURCES));
  const finalUrlCandidate = sanitizeUrl(
    normalizedUrl,
    firstFromSources(document, FINAL_URL_SOURCES)
  );

  let imageUrl = sanitizeImageUrl(normalizedUrl, firstFromSources(document, IMAGE_SOURCES));
  if (!imageUrl) {
    imageUrl = pickFallbackImage(document, normalizedUrl);
  }

  const faviconUrl = sanitizeUrl(normalizedUrl, firstFromSources(document, FAVICON_SOURCES));
  const siteName = sanitizeText(firstFromSources(document, SITE_NAME_SOURCES), 256);
  const author = sanitizeText(firstFromSources(document, AUTHOR_SOURCES), 256);
  const publisher = sanitizeText(firstFromSources(document, PUBLISHER_SOURCES), 256);
  const publishedAtRaw = firstFromSources(document, PUBLISHED_TIME_SOURCES);

  const publishedAt = publishedAtRaw ? publishedAtRaw.trim().slice(0, 128) : undefined;

  const raw = buildDebugEntries(document);

  return {
    title,
    description,
    imageUrl,
    faviconUrl,
    siteName,
    author,
    publisher,
    publishedAt,
    canonicalUrl,
    finalUrl: finalUrlCandidate ?? canonicalUrl ?? normalizedUrl,
    raw,
  };
};

const buildSuccessPreview = (
  url: string,
  parsed: ReturnType<typeof parseLinkPreview>
): LinkPreviewMetadata => ({
  source: LINK_PREVIEW_SOURCE,
  status: "success",
  fetchedAt: Date.now(),
  url,
  ...parsed,
});

const buildErrorPreview = (
  url: string,
  error: {
    type: string;
    message?: string;
    details?: any;
  },
  extras?: {
    screenshotStorageId?: Id<"_storage">;
    screenshotUpdatedAt?: number;
  }
): LinkPreviewMetadata => ({
  source: LINK_PREVIEW_SOURCE,
  status: "error",
  fetchedAt: Date.now(),
  url,
  error,
  ...extras,
});


const captureScreenshot = async (
  ctx: ActionCtx,
  {
    url,
    accountId,
    apiToken,
  }: {
    url: string;
    accountId: string;
    apiToken: string;
  }
) => {
  try {
    const screenshotEndpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`;

    const requestPayload = {
      url,
      waitUntil: "networkidle0",
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      format: "webp",
    };

    const controller = new AbortController();
    const timeoutMs = 45000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(screenshotEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text().catch(() => "<unavailable>");
      const type = response.status === 429 ? "rate_limit" : "http_error";
      console.warn(
        `[linkMetadata] Screenshot capture error ${response.status} for ${url}: ${text.slice(0, 2000)}`
      );
      return {
        error: {
          type,
          message: `Screenshot API returned ${response.status}`,
          details: text?.slice(0, 2000),
        },
      };
    }

    const payload = await response.json();
    if (!payload?.result?.screenshot) {
      return {
        error: {
          type: "invalid_response",
          message: "Screenshot response missing payload",
          details: payload,
        },
      };
    }

    const { screenshot } = payload.result;
    const mimeType = screenshot?.mimeType || "image/webp";
    const imageBase64 = screenshot?.data;
    if (!imageBase64) {
      return {
        error: {
          type: "invalid_response",
          message: "Screenshot image missing data",
        },
      };
    }

    const imageArrayBuffer = Buffer.from(imageBase64, "base64");
    const screenshotBlob = new Blob([imageArrayBuffer], {
      type: mimeType,
    });

    const screenshotId = await ctx.storage.store(screenshotBlob);
    return {
      screenshotId,
      screenshotUpdatedAt: Date.now(),
    };
  } catch (error) {
    console.error(`[linkMetadata] Screenshot capture error for ${url}:`, error);
    let type = "error";
    if ((error as any)?.name === "AbortError") {
      type = "timeout";
    } else if ((error as any)?.name === "TypeError" && (error as any)?.message?.includes("fetch")) {
      type = "network_error";
    }
    return {
      error: {
        type,
        message: (error as Error)?.message,
      },
    };
  }
};

const SCREENSHOT_RATE_LIMIT_MAX_RETRIES = 3;
const SCREENSHOT_RETRY_DELAY_MS = 15000;
const SCREENSHOT_HTTP_RETRY_DELAY_MS = 5000;

export const generateLinkScreenshot = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    const card = await ctx.runQuery(internal.linkMetadataDb.getCardForMetadata, { cardId });

    if (!card || card.type !== "link" || !card.url) {
      return;
    }

    const linkPreview = card.metadata?.linkPreview;
    if (!linkPreview || linkPreview.status !== "success") {
      console.log(
        `[linkMetadata] Skipping screenshot for card ${cardId} because link preview metadata is not ready`
      );
      return;
    }

    if (linkPreview.screenshotStorageId && retryCount === 0) {
      // Screenshot already exists; nothing to do
      return;
    }

    const accountId = process.env.CLOUDFLARE_BROWSER_RENDERING_ACCOUNT_ID;
    const apiToken =
      process.env.CLOUDFLARE_BROWSER_RENDERING_API_TOKEN ||
      process.env.CLOUDFLARE_API_TOKEN ||
      process.env.CLOUDFLARE_API_KEY;

    if (!accountId || !apiToken) {
      console.error(`[linkMetadata] Missing Cloudflare credentials for screenshot of card ${cardId}`);
      return;
    }

    const normalizedUrl = normalizeUrl(card.url);
    const screenshotResult = await captureScreenshot(ctx, {
      accountId,
      apiToken,
      url: normalizedUrl,
    });

    if (screenshotResult?.screenshotId) {
      await ctx.runMutation(internal.linkMetadataDb.updateCardScreenshot, {
        cardId,
        screenshotStorageId: screenshotResult.screenshotId,
        screenshotUpdatedAt: screenshotResult.screenshotUpdatedAt ?? Date.now(),
      });
      console.log(`[linkMetadata] Stored screenshot for card ${cardId}`);
      return;
    }

    if (!screenshotResult?.error) {
      return;
    }

    const { type } = screenshotResult.error;
    const nextRetryCount = retryCount + 1;

    if (type === "rate_limit" && retryCount < SCREENSHOT_RATE_LIMIT_MAX_RETRIES) {
      console.warn(
        `[linkMetadata] Screenshot rate limited for card ${cardId}, retry ${nextRetryCount} in ${SCREENSHOT_RETRY_DELAY_MS}ms`
      );
      await ctx.scheduler.runAfter(SCREENSHOT_RETRY_DELAY_MS, internal.linkMetadata.generateLinkScreenshot, {
        cardId,
        retryCount: nextRetryCount,
      });
      return;
    }

    if (type === "http_error" && retryCount < 1) {
      console.warn(
        `[linkMetadata] Screenshot HTTP error for card ${cardId}, retry ${nextRetryCount} in ${SCREENSHOT_HTTP_RETRY_DELAY_MS}ms`
      );
      await ctx.scheduler.runAfter(SCREENSHOT_HTTP_RETRY_DELAY_MS, internal.linkMetadata.generateLinkScreenshot, {
        cardId,
        retryCount: nextRetryCount,
      });
      return;
    }

    console.warn(
      `[linkMetadata] Screenshot capture failed for card ${cardId} after ${retryCount + 1} attempt(s):`,
      screenshotResult.error
    );
  },
});

const RATE_LIMIT_MAX_RETRIES = 3; // allow 4 total attempts for 429 responses
const HTTP_MAX_RETRIES = 1; // allow 2 total attempts for other HTTP errors

export const extractLinkMetadata = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    "use node";

    let normalizedUrl = "";
    try {
      const card = await ctx.runQuery(internal.linkMetadataDb.getCardForMetadata, { cardId });

      if (!card || card.type !== "link" || !card.url) {
        console.error(`[linkMetadata] Card ${cardId} is not a valid link card`);
        await ctx.runMutation(internal.linkMetadataDb.updateCardMetadata, {
          cardId,
          linkPreview: buildErrorPreview(card?.url ?? "", {
            type: "invalid_card",
            message: "Card is missing a valid URL",
          }),
          status: "failed",
        });
        return;
      }

      normalizedUrl = normalizeUrl(card.url);
      const urlInstance = new URL(normalizedUrl);
      if (!isHttpScheme(urlInstance.protocol)) {
        await ctx.runMutation(internal.linkMetadataDb.updateCardMetadata, {
          cardId,
          linkPreview: buildErrorPreview(normalizedUrl, {
            type: "invalid_url",
            message: "Only HTTP and HTTPS URLs are supported",
          }),
          status: "failed",
        });
        return;
      }

      console.log(
        `[linkMetadata] Extracting metadata for card ${cardId}, URL: ${normalizedUrl} (attempt ${retryCount + 1})`
      );

      const startedAt = Date.now();
      const { html, finalUrl } = await fetchHtml(normalizedUrl);

      const parsed = parseLinkPreview(finalUrl, html);
      const linkPreview = buildSuccessPreview(normalizedUrl, parsed);

      await ctx.runMutation(internal.linkMetadataDb.updateCardMetadata, {
        cardId,
        linkPreview,
        status: "completed",
      });

      console.log(`[linkMetadata] Metadata extracted for card ${cardId} in ${Date.now() - startedAt}ms`, {
        title: Boolean(linkPreview.title),
        description: Boolean(linkPreview.description),
        image: Boolean(linkPreview.imageUrl),
        favicon: Boolean(linkPreview.faviconUrl),
        siteName: Boolean(linkPreview.siteName),
        finalUrl: linkPreview.finalUrl,
      });

      await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.startProcessingPipeline, {
        cardId,
      });
    } catch (error) {
      console.error(`[linkMetadata] Error extracting metadata for card ${cardId}:`, error);

      const code = (error as any)?.code;
      let errorType = "error";
      let shouldRetry = false;
      let message = (error as Error)?.message;
      let details: any;

      switch (code) {
        case "timeout":
          errorType = "timeout";
          shouldRetry = retryCount < 2;
          break;
        case "dns_error":
          errorType = "dns_error";
          shouldRetry = retryCount < 1;
          break;
        case "blocked_address":
        case "blocked_scheme":
        case "redirect_error":
        case "invalid_content_type":
        case "response_too_large":
          errorType = code;
          break;
        case "http_error":
          errorType = "http_error";
          details = { status: (error as any)?.status };
          shouldRetry =
            ((error as any)?.status === 429 && retryCount < RATE_LIMIT_MAX_RETRIES) ||
            ((error as any)?.status &&
              (error as any)?.status >= 500 &&
              retryCount < HTTP_MAX_RETRIES);
          break;
        case "too_many_redirects":
          errorType = "too_many_redirects";
          break;
        default:
          if ((error as any)?.name === "AbortError") {
            errorType = "timeout";
            shouldRetry = retryCount < 2;
          } else if ((error as any)?.name === "TypeError" && (error as any)?.message?.includes("fetch")) {
            errorType = "network_error";
            shouldRetry = retryCount < 1;
          }
          break;
      }

      if (shouldRetry) {
        console.log(
          `[linkMetadata] Retrying metadata extraction for card ${cardId} in 5 seconds (retry ${retryCount + 1})`
        );
        await ctx.scheduler.runAfter(5000, internal.linkMetadata.extractLinkMetadata, {
          cardId,
          retryCount: retryCount + 1,
        });
        return;
      }

      const fallbackUrl = normalizedUrl || "";
      await ctx.runMutation(internal.linkMetadataDb.updateCardMetadata, {
        cardId,
        linkPreview: buildErrorPreview(
          fallbackUrl,
          {
            type: errorType,
            message,
            details,
          }
        ),
        status: "failed",
      });
    }
  },
});

export const __testExports = {
  normalizeUrl,
  sanitizeText,
  sanitizeUrl,
  sanitizeImageUrl,
  parseLinkPreview,
  pickFallbackImage,
  isBlockedAddress,
};
