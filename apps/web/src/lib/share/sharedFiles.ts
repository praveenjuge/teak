import {
  SHARE_CACHE,
  SHARE_FILE_NAME_HEADER,
  SHARE_FILE_PREFIX,
  SHARE_FILES_MISSING,
} from "./sharedContent";

const fileIndex = (url: string) => Number(url.split("/").at(-1));

/**
 * Takes the files the service worker kept for share `id` out of Cache
 * Storage, in the order they were shared. Null when they're gone: expired,
 * shared on another device, or never kept.
 */
export const takeSharedFiles = async (
  storage: CacheStorage | undefined,
  id: string
): Promise<File[] | null> => {
  if (!storage || id === SHARE_FILES_MISSING || id.includes("/")) {
    return null;
  }
  const cache = await storage.open(SHARE_CACHE);
  const prefix = `${SHARE_FILE_PREFIX}${id}/`;
  const requests = (await cache.keys())
    .filter((request) => new URL(request.url).pathname.startsWith(prefix))
    .sort((a, b) => fileIndex(a.url) - fileIndex(b.url));
  const files: File[] = [];
  for (const request of requests) {
    const response = await cache.match(request);
    if (response) {
      const blob = await response.blob();
      const name = decodeURIComponent(
        response.headers.get(SHARE_FILE_NAME_HEADER) ?? "file"
      );
      files.push(new File([blob], name, { type: blob.type }));
    }
    await cache.delete(request);
  }
  return files.length > 0 ? files : null;
};
