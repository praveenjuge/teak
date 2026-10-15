/**
 * The HTTP contract between the Files Worker and its link fetcher Container.
 * The Worker's LinkFetcher Durable Object reuses the media renderer's start-up
 * and health check, so the port and protocol number match the renderer's.
 */

import type { FilesRemoteAssetKind } from "../../../../packages/files-protocol/src/remoteAsset";

export const FETCHER_PORT = 8080;
export const FETCHER_PROTOCOL = 1;
export const FETCHER_PATH = "/fetch";

/** At most this many downloads at once; the next gets 503 `busy`. */
export const FETCHER_MAX_IN_FLIGHT = 4;

export interface FetcherRequest {
  fallbackContentType?: string;
  kind: FilesRemoteAssetKind;
  url: string;
}

/** Facts about a 200 response's bytes, sent as response headers. */
export const FETCHER_HEADERS = {
  contentType: "x-teak-asset-content-type",
  height: "x-teak-asset-height",
  width: "x-teak-asset-width",
} as const;
