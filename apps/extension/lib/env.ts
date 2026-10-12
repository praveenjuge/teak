/**
 * Single runtime accessor for the extension workspace's public Convex origin.
 *
 * Application code reads the generated VITE_PUBLIC_CONVEX_SITE_URL alias
 * through here; nothing else touches it directly (enforced by
 * `bun run audit:env`).
 */

export const getConvexSiteUrl = (): string => {
  const url = import.meta.env.VITE_PUBLIC_CONVEX_SITE_URL;
  if (!url) {
    throw new Error("Missing VITE_PUBLIC_CONVEX_SITE_URL in extension runtime");
  }
  return url;
};

/**
 * Build-time check for `wxt build`: without the Convex site URL the bundle
 * builds but can't reach Teak. Returns the error to show, or null when set.
 */
export const missingBuildEnvError = (
  env: Record<string, string | undefined>
): string | null =>
  env.VITE_PUBLIC_CONVEX_SITE_URL?.trim()
    ? null
    : "VITE_PUBLIC_CONVEX_SITE_URL is not set, so this extension build couldn't reach Teak. Run 'bun run setup --target extension' (or export the variable), then build again.";
