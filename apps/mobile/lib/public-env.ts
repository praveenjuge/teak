/**
 * Single runtime accessor for the mobile workspace's public Convex origins.
 *
 * Application code reads the generated EXPO_PUBLIC_CONVEX_* aliases through
 * here; nothing else touches them directly (enforced by `bun run audit:env`).
 */

const missing = (name: string): Error =>
  new Error(
    `Missing ${name} environment variable (run: bun run setup --target mobile-simulator, expected local Convex defaults)`
  );

export const getConvexUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!url) {
    throw missing("EXPO_PUBLIC_CONVEX_URL");
  }
  return url;
};

export const getConvexSiteUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
  if (!url) {
    throw missing("EXPO_PUBLIC_CONVEX_SITE_URL");
  }
  return url;
};
