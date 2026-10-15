/**
 * store-remote-asset: download a link preview's image or a social post's
 * media through the link fetcher Container and store it in R2. Convex used to
 * download these itself and upload them again through this Worker; now the
 * bytes go from the origin to R2 without passing through Convex.
 *
 * The Container is the only part of the Worker with internet access. It
 * applies Convex's SSRF policy and pins each connection to the addresses it
 * checked (fetcher/src/fetchAsset.ts).
 */

import {
  FILES_REMOTE_ASSET_MAX_BYTES,
  FILES_REMOTE_ASSET_MAX_URL_LENGTH,
  type FilesRemoteAssetParams,
  type FilesRemoteAssetResult,
  type FilesRemoteAssetSkipReason,
  isRemoteAssetContentTypeAllowed,
} from "@teak/files-protocol";
import {
  FETCHER_HEADERS,
  FETCHER_PATH,
  type FetcherRequest,
} from "../fetcher/src/protocol";
import { MediaRenderer } from "./mediaRenderer";
import { RendererUnavailable, rendererInstanceOrder } from "./rendererClient";
import { isValidUploadKey } from "./upload";

/** The renderer's Durable Object, starting its Container with internet on. */
export class LinkFetcher extends MediaRenderer {
  protected override readonly enableInternet = true;
}

export interface RemoteAssetEnv {
  BUCKET: R2Bucket;
  LINK_FETCHER?: DurableObjectNamespace;
  /** Pool size; matches the fetcher Container's max_instances. */
  LINK_FETCHER_INSTANCES?: string;
}

const DEFAULT_POOL_SIZE = 2;
const MAX_POOL_SIZE = 16;
// The Container gives each of up to six redirect hops 30 seconds; this also
// covers a cold start and its health check. Convex waits a little longer.
const FETCH_TIMEOUT_MS = 210_000;
const MAX_CONTENT_TYPE_LENGTH = 255;

const SKIP_REASONS = new Set<FilesRemoteAssetSkipReason>([
  "blocked_url",
  "empty",
  "fetch_failed",
  "http_error",
  "invalid_image",
  "too_large",
  "unsupported_type",
]);

export const parseRemoteAssetParams = (
  params: Record<string, unknown>
): FilesRemoteAssetParams => {
  const { destinationKey, fallbackContentType, kind, url } = params;
  if (
    (kind !== "image" && kind !== "video") ||
    typeof url !== "string" ||
    !url ||
    url.length > FILES_REMOTE_ASSET_MAX_URL_LENGTH ||
    typeof destinationKey !== "string" ||
    !isValidUploadKey(destinationKey) ||
    (fallbackContentType !== undefined &&
      (typeof fallbackContentType !== "string" ||
        fallbackContentType.length > MAX_CONTENT_TYPE_LENGTH))
  ) {
    throw new Error("invalid_remote_asset_params");
  }
  return {
    destinationKey,
    kind,
    url,
    ...(fallbackContentType ? { fallbackContentType } : {}),
  };
};

const poolSize = (env: RemoteAssetEnv): number => {
  const parsed = Number(env.LINK_FETCHER_INSTANCES);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_POOL_SIZE)
    : DEFAULT_POOL_SIZE;
};

// SVGs can have fractional dimensions (a 23 x 20.46 icon); keep them as is,
// as Convex did when it read them itself.
const positiveDimension = (value: string | null): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const { FixedLengthStream: FixedLength } = globalThis as {
  FixedLengthStream?: new (
    length: number
  ) => { readable: ReadableStream; writable: WritableStream };
};

// R2 needs the length of a streamed body up front; FixedLengthStream also
// fails the put if the fetcher sends more or fewer bytes than it declared.
const withLength = (body: ReadableStream, length: number): ReadableStream => {
  if (!FixedLength) {
    return body;
  }
  const { readable, writable } = new FixedLength(length);
  body.pipeTo(writable).catch(() => undefined);
  return readable;
};

const readSkip = async (
  response: Response
): Promise<FilesRemoteAssetResult> => {
  const body = (await response.json().catch(() => null)) as {
    reason?: unknown;
    status?: unknown;
  } | null;
  const reason = SKIP_REASONS.has(body?.reason as FilesRemoteAssetSkipReason)
    ? (body?.reason as FilesRemoteAssetSkipReason)
    : "fetch_failed";
  return {
    reason,
    stored: false,
    ...(typeof body?.status === "number" ? { status: body.status } : {}),
  };
};

export const storeRemoteAsset = async (
  env: RemoteAssetEnv,
  params: FilesRemoteAssetParams,
  random: () => number = Math.random
): Promise<FilesRemoteAssetResult> => {
  const namespace = env.LINK_FETCHER;
  if (!namespace) {
    throw new RendererUnavailable("fetcher_binding_missing");
  }
  const request: FetcherRequest = {
    kind: params.kind,
    url: params.url,
    ...(params.fallbackContentType
      ? { fallbackContentType: params.fallbackContentType }
      : {}),
  };
  let lastReason = "busy";
  for (const name of rendererInstanceOrder(poolSize(env), random, "fetcher")) {
    let response: Response;
    try {
      response = await namespace.get(namespace.idFromName(name)).fetch(
        new Request(`http://fetcher${FETCHER_PATH}`, {
          body: JSON.stringify(request),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
      );
    } catch (error) {
      throw new RendererUnavailable(
        error instanceof Error && error.name === "TimeoutError"
          ? "fetcher_timeout"
          : "fetcher_request_failed"
      );
    }
    if (response.status === 503) {
      lastReason = "fetcher_busy";
      await response.body?.cancel().catch(() => undefined);
      continue;
    }
    if (response.status === 422) {
      return await readSkip(response);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new RendererUnavailable(`fetcher_status_${response.status}`);
    }
    const contentType = response.headers.get(FETCHER_HEADERS.contentType);
    if (
      !(
        contentType && isRemoteAssetContentTypeAllowed(params.kind, contentType)
      )
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new RendererUnavailable("fetcher_bad_response");
    }
    // Stream the body into R2 rather than holding up to 50 MiB in the
    // isolate; the fetcher always sends the exact length.
    const length = Number(response.headers.get("content-length"));
    const width = positiveDimension(
      response.headers.get(FETCHER_HEADERS.width)
    );
    const height = positiveDimension(
      response.headers.get(FETCHER_HEADERS.height)
    );
    if (
      !(
        response.body &&
        Number.isSafeInteger(length) &&
        length > 0 &&
        length <= FILES_REMOTE_ASSET_MAX_BYTES[params.kind]
      ) ||
      (params.kind === "image" && !(width && height))
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new RendererUnavailable("fetcher_bad_response");
    }
    await env.BUCKET.put(
      params.destinationKey,
      withLength(response.body, length),
      { httpMetadata: { contentType } }
    );
    return {
      contentType,
      size: length,
      stored: true,
      ...(width && height ? { height, width } : {}),
    };
  }
  throw new RendererUnavailable(lastReason);
};
