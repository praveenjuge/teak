import { TEAK_FILES_ORIGINS } from "@teak/convex/shared/constants";
import {
  type FilesImageRendition,
  parseFilesImagePath,
} from "@teak/convex/shared/filesImages";

const TEAK_FILES_HOSTS: ReadonlySet<string> = new Set(
  Object.values(TEAK_FILES_ORIGINS).map((origin) => new URL(origin).hostname)
);

const RETRY_PARAM = "teak_retry";

const teakFilesUrl = (url: string): URL | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && TEAK_FILES_HOSTS.has(parsed.hostname)
      ? parsed
      : null;
  } catch {
    return null;
  }
};

export function appendMediaRetryParam(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(RETRY_PARAM, "1");
  return parsed.toString();
}

/** A Teak files URL that hasn't been refreshed once already. */
export function canRetryMedia(url: string): boolean {
  const parsed = teakFilesUrl(url);
  return parsed !== null && !parsed.searchParams.has(RETRY_PARAM);
}

export function getMediaRenditionFromUrl(
  url: string
): FilesImageRendition | undefined {
  const parsed = teakFilesUrl(url);
  return parsed ? parseFilesImagePath(parsed.pathname)?.rendition : undefined;
}
