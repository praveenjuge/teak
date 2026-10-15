/**
 * Download one remote preview asset with the same SSRF policy, address
 * pinning, limits and checks Convex applied when it downloaded assets itself.
 * The policy code is Convex's own, bundled by path, so there is one copy.
 */

import {
  type DnsResolver,
  type PinnedFetch,
  readBodyWithLimit,
  SsrfError,
  safeFetch,
} from "../../../../packages/convex/linkMetadata/ssrf";
import { readRemoteImageDimensions } from "../../../../packages/convex/workflows/steps/linkMetadata/remoteImageDimensions";
import {
  FILES_REMOTE_ASSET_MAX_BYTES,
  FILES_REMOTE_ASSET_MAX_URL_LENGTH,
  type FilesRemoteAssetSkipReason,
  isRemoteAssetContentTypeAllowed,
  isRemoteAssetPageUrl,
  resolveRemoteAssetContentType,
} from "../../../../packages/files-protocol/src/remoteAsset";
import type { FetcherRequest } from "./protocol";

const MAX_CONTENT_TYPE_LENGTH = 255;
// The browser the page scrape presents as. Some image CDNs block other
// clients outright: Figma's s3-alpha.figma.com sits behind AWS WAF bot
// control, which answers 403 to undici's default `node` agent.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const parseFetcherRequest = (value: unknown): FetcherRequest | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { fallbackContentType, kind, pageUrl, url } = value as Record<
    string,
    unknown
  >;
  if (
    (kind !== "image" && kind !== "video") ||
    typeof url !== "string" ||
    !url ||
    url.length > FILES_REMOTE_ASSET_MAX_URL_LENGTH ||
    (fallbackContentType !== undefined &&
      (typeof fallbackContentType !== "string" ||
        fallbackContentType.length > MAX_CONTENT_TYPE_LENGTH)) ||
    !(pageUrl === undefined || isRemoteAssetPageUrl(pageUrl))
  ) {
    return null;
  }
  return {
    kind,
    url,
    ...(fallbackContentType ? { fallbackContentType } : {}),
    ...(pageUrl ? { pageUrl } : {}),
  };
};

// What a browser sends to another site by default
// (strict-origin-when-cross-origin): only the page's origin, so the asset host
// never learns which page, and nothing on a hop from an https page to http.
const refererFor = (
  pageUrl: string | undefined,
  targetUrl: string
): string | undefined => {
  if (!pageUrl) {
    return;
  }
  const page = new URL(pageUrl);
  return page.protocol === "https:" && new URL(targetUrl).protocol === "http:"
    ? undefined
    : `${page.origin}/`;
};

export type FetchAssetOutcome =
  | {
      bytes: Uint8Array;
      contentType: string;
      height?: number;
      ok: true;
      width?: number;
    }
  | { ok: false; reason: FilesRemoteAssetSkipReason; status?: number };

export interface FetchAssetDeps {
  pinnedFetch: PinnedFetch;
  resolveDns: DnsResolver;
}

const skip = (
  reason: FilesRemoteAssetSkipReason,
  status?: number
): FetchAssetOutcome => ({
  ok: false,
  reason,
  ...(status === undefined ? {} : { status }),
});

export const fetchRemoteAsset = async (
  request: FetcherRequest,
  { pinnedFetch, resolveDns }: FetchAssetDeps
): Promise<FetchAssetOutcome> => {
  const maxBytes = FILES_REMOTE_ASSET_MAX_BYTES[request.kind];
  // safeFetch checks each redirect hop before calling this, so the Referer,
  // set per hop, never changes which hosts it allows.
  const fetchHop: PinnedFetch = (url, addresses, init) => {
    const referer = refererFor(request.pageUrl, url);
    const headers = new Headers(init.headers);
    if (referer) {
      headers.set("referer", referer);
    }
    return pinnedFetch(url, addresses, { ...init, headers });
  };
  let response: Response;
  try {
    response = await safeFetch(
      request.url,
      resolveDns,
      { headers: { "user-agent": USER_AGENT } },
      fetchHop
    );
  } catch (error) {
    if (error instanceof SsrfError) {
      return skip("blocked_url");
    }
    return skip("fetch_failed");
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return skip("http_error", response.status);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return skip("too_large");
  }

  const contentType = resolveRemoteAssetContentType(
    response.headers.get("content-type"),
    request.url,
    request.fallbackContentType
  );
  if (
    !(contentType && isRemoteAssetContentTypeAllowed(request.kind, contentType))
  ) {
    await response.body?.cancel().catch(() => undefined);
    return skip("unsupported_type");
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(response, maxBytes);
  } catch (error) {
    return error instanceof Error && error.message.startsWith("body_too_large")
      ? skip("too_large")
      : skip("fetch_failed");
  }
  if (!bytes.byteLength) {
    return skip("empty");
  }

  if (request.kind === "video") {
    return { bytes, contentType, ok: true };
  }
  const dimensions = readRemoteImageDimensions(bytes);
  return dimensions
    ? { bytes, contentType, ok: true, ...dimensions }
    : skip("invalid_image");
};
