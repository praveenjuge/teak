import { getSafeUrlHostname } from "@teak/convex/shared/utils/safeUrl";

/** The site a link names, as people read it: `theverge.com`, never `www.`. */
export function getDisplayHostname(url?: string): string | undefined {
  return getSafeUrlHostname(url)?.replace(/^www\./, "") || undefined;
}
