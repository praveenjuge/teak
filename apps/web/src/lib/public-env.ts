import { DEFAULT_TEAK_DEV_CONVEX_URL } from "@teak/convex/devUrls";
import { TEAK_FILES_ORIGINS } from "@teak/convex/shared/filesOrigins";

export type PublicEnvironment = "development" | "production" | "test";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const missing = (name: string, local: string): Error =>
  new Error(
    `Missing ${name} environment variable (run: bun run setup, expected ${local} locally)`
  );

export const readConvexUrl = (): string | undefined =>
  process.env.NEXT_PUBLIC_CONVEX_URL;

/** A self-hosted deployment's files host; Teak's own when unset. */
const readFilesBase = (): string | undefined =>
  process.env.NEXT_PUBLIC_FILES_BASE;

/**
 * The origin of a configured URL the page may talk to: https, or plain http
 * on this machine in development and test (the local stack).
 */
export const configuredOrigin = (
  value: string | undefined,
  environment: PublicEnvironment | undefined
): string | null => {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (url.username || url.password) {
      return null;
    }
    if (url.protocol === "https:") {
      return url.origin;
    }
    return (environment === "development" || environment === "test") &&
      url.protocol === "http:" &&
      LOOPBACK_HOSTS.has(url.hostname)
      ? url.origin
      : null;
  } catch {
    return null;
  }
};

/**
 * Every origin card files load from, the one in use first: a self-hosted
 * deployment's files host, the development Core Worker when the app talks to
 * Teak's development deployment, then Teak's own files host.
 */
export const filesOrigins = (
  environment: PublicEnvironment | undefined = process.env.NODE_ENV
): string[] => {
  const convexOrigin = configuredOrigin(readConvexUrl(), environment);
  return [
    ...new Set(
      [
        configuredOrigin(readFilesBase(), environment),
        convexOrigin === DEFAULT_TEAK_DEV_CONVEX_URL
          ? TEAK_FILES_ORIGINS.development
          : null,
        TEAK_FILES_ORIGINS.production,
      ].filter((origin): origin is string => origin !== null)
    ),
  ];
};

/** The origin card files load from, for the page to connect to early. */
export const filesOrigin = (): string =>
  filesOrigins()[0] ?? TEAK_FILES_ORIGINS.production;

export const getConvexUrl = (): string => {
  const url = readConvexUrl();
  if (!url) {
    throw missing("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210");
  }
  return url;
};
