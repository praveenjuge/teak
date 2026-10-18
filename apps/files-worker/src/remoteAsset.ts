import { SAFE_FETCH_MAX_DURATION_MS } from "@teak/convex/linkMetadata/ssrf";
import {
  FILES_REMOTE_ASSET_MAX_BYTES,
  FILES_REMOTE_ASSET_MAX_URL_LENGTH,
  type FilesRemoteAssetParams,
  type FilesRemoteAssetResult,
  type FilesRemoteAssetSkipReason,
  isRemoteAssetContentTypeAllowed,
  isRemoteAssetPageUrl,
} from "@teak/files-protocol";
import {
  FETCHER_HEADERS,
  FETCHER_PATH,
  FETCHER_PORT,
  FETCHER_PROTOCOL,
  type FetcherRequest,
} from "../fetcher/src/protocol";
import { MediaRenderer } from "./mediaRenderer";
import { RendererUnavailable, rendererInstanceOrder } from "./rendererClient";
import { isValidUploadKey } from "./upload";

export class LinkFetcher extends MediaRenderer {
  protected override readonly enableInternet = true;
  protected override readonly port = FETCHER_PORT;
  protected override readonly protocol = FETCHER_PROTOCOL;
}

export interface RemoteAssetEnv {
  BUCKET: R2Bucket;
  LINK_FETCHER?: DurableObjectNamespace;
  LINK_FETCHER_INSTANCES?: string;
}

const DEFAULT_POOL_SIZE = 2;
const MAX_POOL_SIZE = 16;
const FETCHER_START_ALLOWANCE_MS = 30_000;
const FETCH_TIMEOUT_MS =
  SAFE_FETCH_MAX_DURATION_MS + FETCHER_START_ALLOWANCE_MS;
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
  const { destinationKey, fallbackContentType, kind, pageUrl, url } = params;
  if (
    (kind !== "image" && kind !== "video") ||
    typeof url !== "string" ||
    !url ||
    url.length > FILES_REMOTE_ASSET_MAX_URL_LENGTH ||
    typeof destinationKey !== "string" ||
    !isValidUploadKey(destinationKey) ||
    (fallbackContentType !== undefined &&
      (typeof fallbackContentType !== "string" ||
        fallbackContentType.length > MAX_CONTENT_TYPE_LENGTH)) ||
    !(pageUrl === undefined || isRemoteAssetPageUrl(pageUrl))
  ) {
    throw new Error("invalid_remote_asset_params");
  }
  return {
    destinationKey,
    kind,
    url,
    ...(fallbackContentType ? { fallbackContentType } : {}),
    ...(pageUrl ? { pageUrl } : {}),
  };
};

const poolSize = (
  env: Pick<RemoteAssetEnv, "LINK_FETCHER_INSTANCES">
): number => {
  const parsed = Number(env.LINK_FETCHER_INSTANCES);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_POOL_SIZE)
    : DEFAULT_POOL_SIZE;
};

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

export const postToFetcher = async (
  env: Pick<RemoteAssetEnv, "LINK_FETCHER" | "LINK_FETCHER_INSTANCES">,
  path: string,
  body: unknown,
  random: () => number = Math.random
): Promise<Response> => {
  const namespace = env.LINK_FETCHER;
  if (!namespace) {
    throw new RendererUnavailable("fetcher_binding_missing");
  }
  let lastReason = "busy";
  for (const name of rendererInstanceOrder(poolSize(env), random, "fetcher")) {
    let response: Response;
    try {
      response = await namespace.get(namespace.idFromName(name)).fetch(
        new Request(`http://fetcher${path}`, {
          body: JSON.stringify(body),
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
    return response;
  }
  throw new RendererUnavailable(lastReason);
};

export const storeRemoteAsset = async (
  env: RemoteAssetEnv,
  params: FilesRemoteAssetParams,
  random: () => number = Math.random
): Promise<FilesRemoteAssetResult> => {
  const request: FetcherRequest = {
    kind: params.kind,
    url: params.url,
    ...(params.fallbackContentType
      ? { fallbackContentType: params.fallbackContentType }
      : {}),
    ...(params.pageUrl ? { pageUrl: params.pageUrl } : {}),
  };
  const response = await postToFetcher(env, FETCHER_PATH, request, random);
  if (response.status === 422) {
    return await readSkip(response);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new RendererUnavailable(`fetcher_status_${response.status}`);
  }
  const contentType = response.headers.get(FETCHER_HEADERS.contentType);
  if (
    !(contentType && isRemoteAssetContentTypeAllowed(params.kind, contentType))
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new RendererUnavailable("fetcher_bad_response");
  }
  const length = Number(response.headers.get("content-length"));
  const width = positiveDimension(response.headers.get(FETCHER_HEADERS.width));
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
};
