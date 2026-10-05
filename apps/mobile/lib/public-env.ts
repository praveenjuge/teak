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

const readConvexOrigin = (
  value: string,
  name: string,
  hostedDomain: "convex.cloud" | "convex.site"
): string => {
  const invalid = () =>
    new Error(`Invalid ${name}: use a trusted Convex origin.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (value !== url.origin && value !== `${url.origin}/`)
  ) {
    throw invalid();
  }
  const hosted = (
    hostedDomain === "convex.cloud"
      ? /^[a-z0-9][a-z0-9-]*\.convex\.cloud$/
      : /^[a-z0-9][a-z0-9-]*\.convex\.site$/
  ).test(url.hostname);
  if (hosted && url.protocol === "https:" && !url.port) {
    return url.origin;
  }
  const development =
    typeof __DEV__ === "undefined"
      ? process.env.NODE_ENV === "development"
      : __DEV__;
  const parts = url.hostname.split(".").map(Number);
  const privateIpv4 =
    parts.length === 4 &&
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168));
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || privateIpv4;
  if (development && local && ["http:", "https:"].includes(url.protocol)) {
    return url.origin;
  }
  throw invalid();
};

export const getConvexUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!url) {
    throw missing("EXPO_PUBLIC_CONVEX_URL");
  }
  return readConvexOrigin(url, "EXPO_PUBLIC_CONVEX_URL", "convex.cloud");
};

export const getConvexSiteUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
  if (!url) {
    throw missing("EXPO_PUBLIC_CONVEX_SITE_URL");
  }
  return readConvexOrigin(url, "EXPO_PUBLIC_CONVEX_SITE_URL", "convex.site");
};
