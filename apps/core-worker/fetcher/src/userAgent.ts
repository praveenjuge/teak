const DAY_MS = 24 * 60 * 60 * 1000;
/** Chrome 153 reached stable on Sep 8, 2026, and a new major every 14 days since. */
const CHROME_153_STABLE = Date.UTC(2026, 8, 8);
const CHROME_RELEASE_DAYS = 14;

/**
 * The Chrome on a Mac the fetcher presents as. Bot filters (Cloudflare, AWS
 * WAF, Akamai) refuse a Chrome years behind the current one, so the major
 * follows Chrome's release schedule instead of staying pinned.
 */
export const browserUserAgent = (now = Date.now()): string => {
  const releases = Math.floor(
    (now - CHROME_153_STABLE) / (CHROME_RELEASE_DAYS * DAY_MS)
  );
  const major = 153 + Math.max(0, releases);
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
};
