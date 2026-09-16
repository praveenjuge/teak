/**
 * Canonical environment facts and their framework aliases (issue #407).
 *
 * The six public Convex/Site URL variables across Next.js, Vite, and Expo
 * express two canonical deployment facts; the desktop web origin mirrors the
 * app SITE_URL locally. Aliases are GENERATED from canonical values by setup
 * (see scripts/setup.ts) and never maintained by hand:
 *
 * - CONVEX_URL      → NEXT_PUBLIC_CONVEX_URL, VITE_PUBLIC_CONVEX_URL, EXPO_PUBLIC_CONVEX_URL
 * - CONVEX_SITE_URL → NEXT_PUBLIC_CONVEX_SITE_URL, VITE_PUBLIC_CONVEX_SITE_URL, EXPO_PUBLIC_CONVEX_SITE_URL
 * - SITE_URL        → VITE_WEB_URL (local derivation; provider-supplied elsewhere)
 *
 * Note: NEXT_PUBLIC_CONVEX_SITE_URL and friends are the Convex deployment's
 * HTTP-actions URL, not the app origin. They derive from CONVEX_SITE_URL; the
 * app origin SITE_URL only seeds VITE_WEB_URL for local desktop work.
 */

export const CANONICAL_CONVEX_URL = "CONVEX_URL";
export const CANONICAL_CONVEX_SITE_URL = "CONVEX_SITE_URL";
export const CANONICAL_SITE_URL = "SITE_URL";

export const CANONICAL_FACTS = [
  CANONICAL_CONVEX_URL,
  CANONICAL_CONVEX_SITE_URL,
  CANONICAL_SITE_URL,
] as const;

/** Canonical fact → generated framework aliases. */
export const ALIAS_DERIVATIONS: Record<string, readonly string[]> = {
  [CANONICAL_CONVEX_URL]: [
    "NEXT_PUBLIC_CONVEX_URL",
    "VITE_PUBLIC_CONVEX_URL",
    "EXPO_PUBLIC_CONVEX_URL",
  ],
  [CANONICAL_CONVEX_SITE_URL]: [
    "NEXT_PUBLIC_CONVEX_SITE_URL",
    "VITE_PUBLIC_CONVEX_SITE_URL",
    "EXPO_PUBLIC_CONVEX_SITE_URL",
  ],
  [CANONICAL_SITE_URL]: ["VITE_WEB_URL"],
};

const ALIAS_TO_CANONICAL = new Map<string, string>(
  Object.entries(ALIAS_DERIVATIONS).flatMap(([canonical, aliases]) =>
    aliases.map((alias) => [alias, canonical] as const)
  )
);

export const isFrameworkAlias = (name: string): boolean =>
  ALIAS_TO_CANONICAL.has(name);

export const canonicalFor = (name: string): string | undefined =>
  ALIAS_TO_CANONICAL.get(name);

export const frameworkAliases = (): string[] => [...ALIAS_TO_CANONICAL.keys()];

export interface CanonicalDeployment {
  convexSiteUrl: string;
  convexUrl: string;
  siteUrl?: string;
}

/** Expand canonical facts into every framework alias value. */
export const generateAliasValues = (
  canonical: CanonicalDeployment
): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const alias of ALIAS_DERIVATIONS[CANONICAL_CONVEX_URL] ?? []) {
    values[alias] = canonical.convexUrl;
  }
  for (const alias of ALIAS_DERIVATIONS[CANONICAL_CONVEX_SITE_URL] ?? []) {
    values[alias] = canonical.convexSiteUrl;
  }
  if (canonical.siteUrl) {
    for (const alias of ALIAS_DERIVATIONS[CANONICAL_SITE_URL] ?? []) {
      values[alias] = canonical.siteUrl;
    }
  }
  return values;
};
