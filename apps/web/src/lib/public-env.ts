/**
 * Single runtime accessor for the web workspace's public Convex origins.
 *
 * Application code reads the generated NEXT_PUBLIC_CONVEX_* aliases through
 * here; nothing else touches them directly (enforced by `bun run audit:env`).
 * Values are returned raw so callers keep their own normalization.
 */

const missing = (name: string, local: string): Error =>
  new Error(
    `Missing ${name} environment variable (run: bun run setup, expected ${local} locally)`
  );

export const getConvexUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw missing("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210");
  }
  return url;
};

export const getConvexSiteUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!url) {
    throw missing("NEXT_PUBLIC_CONVEX_SITE_URL", "http://127.0.0.1:3211");
  }
  return url;
};
