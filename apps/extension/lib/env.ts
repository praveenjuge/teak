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
