import {
  SHARE_CACHE,
  SHARE_FILE_NAME_HEADER,
  SHARE_FILE_PREFIX,
  SHARE_FILES_MISSING,
} from "./sharedContent";

const fileIndex = (url: string) => Number(url.split("/").at(-1));

const sharedRequests = async (
  storage: CacheStorage | undefined,
  id: string
) => {
  if (!storage || id === SHARE_FILES_MISSING || id.includes("/")) {
    return null;
  }
  const cache = await storage.open(SHARE_CACHE);
  const prefix = `${SHARE_FILE_PREFIX}${id}/`;
  const requests = (await cache.keys())
    .filter((request) => new URL(request.url).pathname.startsWith(prefix))
    .sort((a, b) => fileIndex(a.url) - fileIndex(b.url));
  return { cache, requests };
};

/**
 * Reads the files the service worker kept for share `id` from Cache Storage,
 * in the order they were shared, and deletes them unless `keep` is set (the
 * library keeps them while it asks whether to save them, so a reload asks
 * again). Null when they're gone: expired, shared on another device, or
 * never kept.
 */
export const takeSharedFiles = async (
  storage: CacheStorage | undefined,
  id: string,
  { keep = false }: { keep?: boolean } = {}
): Promise<File[] | null> => {
  const shared = await sharedRequests(storage, id);
  if (!shared) {
    return null;
  }
  const files: File[] = [];
  for (const request of shared.requests) {
    const response = await shared.cache.match(request);
    if (response) {
      const blob = await response.blob();
      const name = decodeURIComponent(
        response.headers.get(SHARE_FILE_NAME_HEADER) ?? "file"
      );
      files.push(new File([blob], name, { type: blob.type }));
    }
    if (!keep) {
      await shared.cache.delete(request);
    }
  }
  return files.length > 0 ? files : null;
};

/** Deletes the files kept for share `id`, once they're saved or turned down. */
export const discardSharedFiles = async (
  storage: CacheStorage | undefined,
  id: string
): Promise<void> => {
  const shared = await sharedRequests(storage, id);
  for (const request of shared?.requests ?? []) {
    await shared?.cache.delete(request);
  }
};
