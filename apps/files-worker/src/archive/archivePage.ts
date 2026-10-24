import { SCRAPE_ELEMENTS } from "@teak/convex/linkMetadata/selectors";
import {
  type DnsResolver,
  readBodyWithLimit,
  safeFetch,
} from "@teak/convex/linkMetadata/ssrf";
import {
  PAGE_ARCHIVE_ROLE,
  PAGE_SNAPSHOT_MAX_BYTES,
  PAGE_SNAPSHOT_MAX_RAW_BYTES,
  PAGE_SNAPSHOT_ROLE,
} from "@teak/convex/shared/pageArchive";
import {
  FILES_LINK_PAGE_MAX_URL_LENGTH,
  type FilesArchivePageParams,
  type FilesArchivePageResult,
  isRemoteAssetPageUrl,
  parseCardObjectKey,
} from "@teak/files-protocol";
import {
  FETCHER_HEADERS,
  FETCHER_PATH,
  type FetcherRequest,
} from "../../fetcher/src/protocol";
import { IMAGES_BINDING_MAX_INPUT_BYTES } from "../images/imagesBinding";
import { fetchLinkPage, type LinkPageEnv } from "../media/linkPage";
import {
  createContainerPinnedFetch,
  createDohResolver,
} from "../media/pinnedHop";
import { postToFetcher, type RemoteAssetEnv } from "../media/remoteAsset";
import { RendererUnavailable } from "../media/rendererClient";
import { isValidUploadKey } from "../storage/upload";
import {
  buildPageArchive,
  type FetchedAsset,
  PAGE_ARCHIVE_MAX_TEXT_BYTES,
  type PageArchiveDeps,
} from "./inline";

export type ArchivePageEnv = LinkPageEnv &
  RemoteAssetEnv & {
    IMAGES?: ImagesBinding;
  };

export interface ArchivePageDeps {
  /** Cloudflare's DNS over HTTPS unless a test gives its own. */
  resolveDns?: DnsResolver;
}

const USER_AGENT = "TeakBot/1.0 (+https://teakvault.com)";
/** Each subresource's own limit; the whole archive has a deadline too. */
const SUBRESOURCE_TIMEOUT_MS = 15_000;
/** Leaves the step's 5 minutes room to write and record the copy. */
const ARCHIVE_DEADLINE_MS = 3 * 60 * 1000;

/** The user part of a key, up to and including `/cards/`. */
const cardsRoot = (key: string): string | null => {
  const index = key.indexOf("/cards/");
  return index > 0 ? key.slice(0, index + "/cards/".length) : null;
};

export const parseArchivePageParams = (
  params: Record<string, unknown>
): FilesArchivePageParams => {
  const { capturedAt, destinationKey, fresh, snapshotKey, url } = params;
  if (
    typeof url !== "string" ||
    !isRemoteAssetPageUrl(url) ||
    url.length > FILES_LINK_PAGE_MAX_URL_LENGTH ||
    typeof capturedAt !== "number" ||
    !Number.isFinite(capturedAt)
  ) {
    throw new Error("invalid_archive_page_params");
  }
  if (
    typeof destinationKey !== "string" ||
    !isValidUploadKey(destinationKey) ||
    parseCardObjectKey(destinationKey).role !== PAGE_ARCHIVE_ROLE
  ) {
    throw new Error("invalid_storage_key");
  }
  if (snapshotKey !== undefined) {
    const root = cardsRoot(destinationKey);
    const parsed =
      typeof snapshotKey === "string" ? parseCardObjectKey(snapshotKey) : {};
    // Only the same account's pending snapshot uploads may be read.
    if (
      typeof snapshotKey !== "string" ||
      !isValidUploadKey(snapshotKey) ||
      !root ||
      cardsRoot(snapshotKey) !== root ||
      parsed.role !== PAGE_SNAPSHOT_ROLE
    ) {
      throw new Error("invalid_storage_key");
    }
  }
  return {
    capturedAt,
    destinationKey,
    url,
    ...(fresh === true ? { fresh: true } : {}),
    ...(typeof snapshotKey === "string" ? { snapshotKey } : {}),
  };
};

/**
 * The extension's page: gunzipped, at most 20 MiB compressed and 60 MiB
 * unzipped. Null sends the archive back to fetching the page itself: a
 * snapshot that was swept, is too big, or isn't valid gzip.
 */
export const readPageSnapshot = async (
  bucket: R2Bucket,
  key: string
): Promise<string | null> => {
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }
  if (object.size > PAGE_SNAPSHOT_MAX_BYTES) {
    await object.body.cancel().catch(() => undefined);
    return null;
  }
  try {
    return await gunzipToText(object.body, PAGE_SNAPSHOT_MAX_RAW_BYTES);
  } catch {
    return null;
  }
};

const gunzipToText = async (
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<string> =>
  new TextDecoder("utf-8").decode(
    await readBodyWithLimit(
      new Response(body.pipeThrough(new DecompressionStream("gzip"))),
      maxBytes
    )
  );

const failureFromPage = (
  reason: string,
  status?: number
): Extract<FilesArchivePageResult, { stored: false }> => {
  switch (reason) {
    case "blocked_url":
      return { reason: "blocked_url", stored: false };
    case "too_large":
      return { reason: "too_large", stored: false };
    case "unsupported_type":
      return { reason: "not_html", stored: false };
    case "http_error":
      return {
        reason: "http_error",
        stored: false,
        ...(status ? { status } : {}),
      };
    default:
      return { reason: "unreachable", stored: false };
  }
};

/**
 * Fetchers for the inliner: stylesheets and fonts through one SSRF-checked
 * `/hop` per request (4 MiB each), images through the fetcher's `/fetch`,
 * which checks them too and reports their size.
 */
export const createArchiveFetchers = (
  env: ArchivePageEnv,
  pageUrl: string,
  deps: ArchivePageDeps = {}
): PageArchiveDeps => {
  const resolveDns = deps.resolveDns ?? createDohResolver();
  const hop = createContainerPinnedFetch(env, {
    maxBytes: PAGE_ARCHIVE_MAX_TEXT_BYTES,
  });
  const fetchThroughHop = async (
    url: string,
    accept: string
  ): Promise<FetchedAsset | null> => {
    try {
      const { response } = await safeFetch(
        url,
        resolveDns,
        {
          headers: { accept, "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(SUBRESOURCE_TIMEOUT_MS),
        },
        hop
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const body = await readBodyWithLimit(
        response,
        PAGE_ARCHIVE_MAX_TEXT_BYTES
      );
      return {
        body,
        contentType: response.headers.get("content-type") ?? "",
      };
    } catch {
      // A refused address (SsrfError), a timeout or a network error: the
      // subresource is left out.
      return null;
    }
  };
  const fetchImage = async (url: string): Promise<FetchedAsset | null> => {
    const request: FetcherRequest = {
      kind: "image",
      url,
      ...(isRemoteAssetPageUrl(pageUrl) ? { pageUrl } : {}),
    };
    let response: Response;
    try {
      response = await postToFetcher(
        env,
        FETCHER_PATH,
        request,
        Math.random,
        SUBRESOURCE_TIMEOUT_MS
      );
    } catch {
      return null;
    }
    const contentType = response.headers.get(FETCHER_HEADERS.contentType);
    if (!(response.ok && contentType?.startsWith("image/"))) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const width = Number(response.headers.get(FETCHER_HEADERS.width));
    const height = Number(response.headers.get(FETCHER_HEADERS.height));
    return {
      body: new Uint8Array(await response.arrayBuffer()),
      contentType,
      ...(width > 0 ? { width } : {}),
      ...(height > 0 ? { height } : {}),
    };
  };
  const images = env.IMAGES;
  return {
    fetchAsset: (url, kind) =>
      kind === "image"
        ? fetchImage(url)
        : fetchThroughHop(url, "font/woff2, font/woff, */*;q=0.1"),
    fetchText: (url) => fetchThroughHop(url, "text/css, */*;q=0.1"),
    ...(images
      ? {
          images: {
            resize: async (asset, width) => {
              if (asset.body.byteLength > IMAGES_BINDING_MAX_INPUT_BYTES) {
                return null;
              }
              const result = await images
                .input(new Response(asset.body).body as ReadableStream)
                .transform({ fit: "scale-down", width })
                .output({ format: "image/webp", quality: 82 });
              return {
                body: new Uint8Array(await result.response().arrayBuffer()),
                contentType: result.contentType(),
                width,
              };
            },
          },
        }
      : {}),
  };
};

/**
 * `archive-page`: builds a link's saved copy from the extension's snapshot,
 * or from the page Teak fetches (the 24-hour copy unless `fresh`), and writes
 * it to `destinationKey`. A page that can't be had answers `stored: false`;
 * a busy fetcher throws, so the step retries.
 */
export const runArchivePage = async (
  env: ArchivePageEnv,
  params: FilesArchivePageParams,
  deps: ArchivePageDeps = {}
): Promise<FilesArchivePageResult> => {
  const deadline = Date.now() + ARCHIVE_DEADLINE_MS;
  let html: string | null = null;
  let pageUrl = params.url;
  let source: "extension" | "server" = "server";
  if (params.snapshotKey) {
    html = await readPageSnapshot(env.BUCKET, params.snapshotKey);
    source = html === null ? "server" : "extension";
  }
  if (html === null) {
    const page = await fetchLinkPage(env, {
      ...(params.fresh ? { fresh: true } : {}),
      selectors: SCRAPE_ELEMENTS.map(({ selector }) => selector),
      url: params.url,
    });
    if (!page.fetched) {
      if (page.reason === "fetch_failed") {
        throw new RendererUnavailable("archive_page_fetch_failed");
      }
      return failureFromPage(page.reason, page.status);
    }
    html = await gunzipToText(
      new Response(
        Uint8Array.from(atob(page.htmlGzipBase64), (char) => char.charCodeAt(0))
      ).body as ReadableStream<Uint8Array>,
      PAGE_SNAPSHOT_MAX_RAW_BYTES
    );
    pageUrl = page.pageUrl;
  }
  const archive = await buildPageArchive({
    ...createArchiveFetchers(env, pageUrl, deps),
    capturedAt: params.capturedAt,
    deadline,
    html,
    pageUrl,
    source,
  });
  await env.BUCKET.put(params.destinationKey, archive.html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });
  return {
    bytes: archive.bytes,
    kind: archive.kind,
    // A snapshot names its page with `<base href>`.
    pageUrl: archive.baseUrl,
    source,
    storageKey: params.destinationKey,
    stored: true,
  };
};
