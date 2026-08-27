const FILES_HOST = "files.teakvault.com";
const RENDITIONS = new Set(["tiny", "compact", "grid", "detail"] as const);

export type MediaRendition = "tiny" | "compact" | "grid" | "detail";

export function appendMediaRetryParam(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("teak_retry", "1");
  return parsed.toString();
}

export function canRetryMedia(url: string, retryCount: number): boolean {
  if (retryCount > 0) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === FILES_HOST && !parsed.searchParams.has("teak_retry")
    );
  } catch {
    return false;
  }
}

export function getMediaRenditionFromUrl(
  url: string
): MediaRendition | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== FILES_HOST) {
      return undefined;
    }
    const candidate = parsed.pathname.match(/^\/__images\/v1\/([^/]+)\//)?.[1];
    return candidate && RENDITIONS.has(candidate as MediaRendition)
      ? (candidate as MediaRendition)
      : undefined;
  } catch {
    return undefined;
  }
}
