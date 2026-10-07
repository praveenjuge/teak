// Production Files Worker, plus the isolated development Worker
// (scripts/check-cloudflare.ts DEVELOPMENT_FILES_ORIGIN). Exact hosts only:
// recovery re-signs through Convex, so other origins are never retried.
export const TEAK_FILES_HOSTS: ReadonlySet<string> = new Set([
  "files.teakvault.com",
  "teak-files-development.praveenjuge.workers.dev",
]);
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
      parsed.protocol === "https:" &&
      TEAK_FILES_HOSTS.has(parsed.hostname) &&
      !parsed.searchParams.has("teak_retry")
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
    if (
      !(parsed.protocol === "https:" && TEAK_FILES_HOSTS.has(parsed.hostname))
    ) {
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
