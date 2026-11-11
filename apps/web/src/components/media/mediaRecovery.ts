import {
  type FilesImageRendition,
  parseFilesImagePath,
} from "@teak/convex/shared/filesImages";
import { filesOrigins } from "@/lib/public-env";

const RETRY_PARAM = "teak_retry";

const filesUrl = (url: string): URL | null => {
  try {
    const parsed = new URL(url);
    return filesOrigins().includes(parsed.origin) ? parsed : null;
  } catch {
    return null;
  }
};

export function appendMediaRetryParam(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(RETRY_PARAM, "1");
  return parsed.toString();
}

/** A card files URL that hasn't been refreshed once already. */
export function canRetryMedia(url: string): boolean {
  const parsed = filesUrl(url);
  return parsed !== null && !parsed.searchParams.has(RETRY_PARAM);
}

export function getMediaRenditionFromUrl(
  url: string
): FilesImageRendition | undefined {
  const parsed = filesUrl(url);
  return parsed ? parseFilesImagePath(parsed.pathname)?.rendition : undefined;
}
