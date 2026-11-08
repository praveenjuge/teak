import {
  FILES_REMOTE_ASSET_MAX_BYTES,
  FILES_REMOTE_ASSET_MAX_URL_LENGTH,
  type FilesRemoteAssetParams,
  type FilesRemoteAssetResult,
  isRemoteAssetContentTypeAllowed,
  isRemoteAssetPageUrl,
  isRemoteAssetSkipReason,
  isValidObjectKey,
} from "@teak/files-protocol";
import {
  FETCHER_HEADERS,
  FETCHER_PATH,
  type FetcherRequest,
} from "../../fetcher/src/protocol";
import { InvalidOpInput } from "../opFailure";
import { RendererUnavailable, withFixedLength } from "./containerPool";
import { type LinkFetcherEnv, postToFetcher } from "./linkFetcher";

export interface RemoteAssetEnv extends LinkFetcherEnv {
  BUCKET: R2Bucket;
}

const MAX_CONTENT_TYPE_LENGTH = 255;

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
    !isValidObjectKey(destinationKey) ||
    (fallbackContentType !== undefined &&
      (typeof fallbackContentType !== "string" ||
        fallbackContentType.length > MAX_CONTENT_TYPE_LENGTH)) ||
    !(pageUrl === undefined || isRemoteAssetPageUrl(pageUrl))
  ) {
    throw new InvalidOpInput("invalid_remote_asset_params");
  }
  return {
    destinationKey,
    kind,
    url,
    ...(fallbackContentType ? { fallbackContentType } : {}),
    ...(pageUrl ? { pageUrl } : {}),
  };
};

const positiveDimension = (value: string | null): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const readSkip = async (
  response: Response
): Promise<FilesRemoteAssetResult> => {
  const body = (await response.json().catch(() => null)) as {
    reason?: unknown;
    status?: unknown;
  } | null;
  const reason = isRemoteAssetSkipReason(body?.reason)
    ? body?.reason
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
    withFixedLength(response.body, length),
    { httpMetadata: { contentType } }
  );
  return {
    contentType,
    size: length,
    stored: true,
    ...(width && height ? { height, width } : {}),
  };
};
