import { readResponseTextWithinLimit } from "@teak/convex/shared/boundedResponse";

const MAX_BROWSER_PREVIEW_BYTES = 1024 * 1024;
const MAX_MEMORY_CACHE_BYTES = 4 * 1024 * 1024;
const PREVIEW_CACHE_TTL_MS = 15 * 60 * 1000;

interface LoadFileTextPreviewOptions {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface PrefetchFileTextPreviewOptions {
  cacheKey: string;
  fetchImpl?: typeof fetch;
  fileUrl: string;
  /** The most bytes read; 1 MiB unless the caller needs more. */
  maxBytes?: number;
}

interface CachedPreview {
  byteLength: number;
  expiresAt: number;
  source: string;
}

const previewCache = new Map<string, CachedPreview>();
const previewRequests = new Map<string, Promise<string | null>>();
let previewCacheBytes = 0;

export async function loadFileTextPreview(
  fileUrl: string,
  options: LoadFileTextPreviewOptions = {}
): Promise<string | null> {
  const maxBytes = options.maxBytes ?? MAX_BROWSER_PREVIEW_BYTES;
  const response = await (options.fetchImpl ?? fetch)(fileUrl, {
    credentials: "omit",
    signal: options.signal,
  });
  const contentLength = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    (Number.isFinite(contentLength) && contentLength > maxBytes)
  ) {
    await response.body?.cancel();
    return null;
  }
  return readResponseTextWithinLimit(response, maxBytes);
}

const dropCacheEntry = (cacheKey: string) => {
  const existing = previewCache.get(cacheKey);
  if (existing) {
    previewCacheBytes -= existing.byteLength;
    previewCache.delete(cacheKey);
  }
};

export const cachedFileTextPreview = (cacheKey: string): string | undefined => {
  const cached = previewCache.get(cacheKey);
  if (!cached) {
    return;
  }
  if (cached.expiresAt <= Date.now()) {
    dropCacheEntry(cacheKey);
    return;
  }
  previewCache.delete(cacheKey);
  previewCache.set(cacheKey, cached);
  return cached.source;
};

const cachePreview = (cacheKey: string, source: string) => {
  const byteLength = new TextEncoder().encode(source).byteLength;
  dropCacheEntry(cacheKey);
  previewCache.set(cacheKey, {
    byteLength,
    expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
    source,
  });
  previewCacheBytes += byteLength;

  while (previewCacheBytes > MAX_MEMORY_CACHE_BYTES && previewCache.size > 1) {
    const oldestKey = previewCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    const oldest = previewCache.get(oldestKey);
    previewCache.delete(oldestKey);
    previewCacheBytes -= oldest?.byteLength ?? 0;
  }
};

export const requestFileTextPreview = ({
  cacheKey,
  fetchImpl,
  fileUrl,
  maxBytes,
}: PrefetchFileTextPreviewOptions): Promise<string | null> => {
  const cached = cachedFileTextPreview(cacheKey);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  const pending = previewRequests.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = loadFileTextPreview(fileUrl, { fetchImpl, maxBytes })
    .then((source) => {
      if (source !== null) {
        cachePreview(cacheKey, source);
      }
      return source;
    })
    .finally(() => previewRequests.delete(cacheKey));
  previewRequests.set(cacheKey, request);
  return request;
};

export const prefetchFileTextPreview = (
  options: PrefetchFileTextPreviewOptions
): Promise<string | null> => requestFileTextPreview(options);
