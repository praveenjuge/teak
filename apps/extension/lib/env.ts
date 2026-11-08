export const getConvexSiteUrl = (): string => {
  const url = import.meta.env.VITE_PUBLIC_CONVEX_SITE_URL;
  if (!url) {
    throw new Error("Missing VITE_PUBLIC_CONVEX_SITE_URL in extension runtime");
  }
  return url;
};

/**
 * Where the extension calls the Teak API: `VITE_PUBLIC_API_URL` when the
 * build sets it (production builds use https://teakvault.com/api, the edge
 * proxy that answers and rate-limits at Cloudflare), else the deployment's
 * Convex site URL, as development and self-hosted builds do.
 */
export const getApiUrl = (): string =>
  import.meta.env.VITE_PUBLIC_API_URL?.trim() || getConvexSiteUrl();

export const missingBuildEnvError = (
  env: Record<string, string | undefined>
): string | null =>
  env.VITE_PUBLIC_CONVEX_SITE_URL?.trim()
    ? null
    : "VITE_PUBLIC_CONVEX_SITE_URL is not set, so this extension build couldn't reach Teak. Run 'bun run setup --target extension' (or export the variable), then build again.";

export const FIREFOX_SENDS_TELEMETRY: boolean = false;

export const getPostHogProjectToken = (): string | undefined =>
  import.meta.env.BROWSER === "firefox" && !FIREFOX_SENDS_TELEMETRY
    ? undefined
    : import.meta.env.WXT_POSTHOG_PROJECT_TOKEN?.trim() || undefined;
