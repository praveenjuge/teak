export const getConvexSiteUrl = (): string => {
  const url = import.meta.env.VITE_PUBLIC_CONVEX_SITE_URL;
  if (!url) {
    throw new Error("Missing VITE_PUBLIC_CONVEX_SITE_URL in extension runtime");
  }
  return url;
};

export const missingBuildEnvError = (
  env: Record<string, string | undefined>
): string | null =>
  env.VITE_PUBLIC_CONVEX_SITE_URL?.trim()
    ? null
    : "VITE_PUBLIC_CONVEX_SITE_URL is not set, so this extension build couldn't reach Teak. Run 'bun run setup --target extension' (or export the variable), then build again.";

export const FIREFOX_SENDS_TELEMETRY = false;

export const getPostHogProjectToken = (): string | undefined =>
  import.meta.env.BROWSER === "firefox" && !FIREFOX_SENDS_TELEMETRY
    ? undefined
    : import.meta.env.WXT_POSTHOG_PROJECT_TOKEN?.trim() || undefined;
