export const DEFAULT_TEAK_DEV_APP_URL = "http://app.teak.localhost:1355";
export const DEFAULT_TEAK_DEV_API_URL = "http://api.teak.localhost:1355";
export const DEFAULT_TEAK_DEV_DOCS_URL = "http://docs.teak.localhost:1355";

export type DevUrlEnv = {
  [key: string]: unknown;
  TEAK_DEV_API_URL?: unknown;
  TEAK_DEV_APP_URL?: unknown;
  TEAK_DEV_DOCS_URL?: unknown;
};

const normalizeBaseUrl = (label: string, rawUrl: string): string => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid ${label}`);
  }

  parsedUrl.pathname = "";
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString().replace(/\/$/, "");
};

const resolveDevUrl = (
  envValue: unknown,
  fallback: string,
  label: string
): string => {
  const resolved = typeof envValue === "string" ? envValue.trim() : "";
  const baseUrl = resolved || fallback;
  return normalizeBaseUrl(label, baseUrl);
};

export const resolveTeakDevAppUrl = (env: DevUrlEnv = {}): string =>
  resolveDevUrl(
    env.TEAK_DEV_APP_URL,
    DEFAULT_TEAK_DEV_APP_URL,
    "TEAK_DEV_APP_URL"
  );

export const resolveTeakDevApiUrl = (env: DevUrlEnv = {}): string =>
  resolveDevUrl(
    env.TEAK_DEV_API_URL,
    DEFAULT_TEAK_DEV_API_URL,
    "TEAK_DEV_API_URL"
  );

export const resolveTeakDevDocsUrl = (env: DevUrlEnv = {}): string =>
  resolveDevUrl(
    env.TEAK_DEV_DOCS_URL,
    DEFAULT_TEAK_DEV_DOCS_URL,
    "TEAK_DEV_DOCS_URL"
  );

export const isLocalDevelopmentHostname = (hostname: string): boolean => {
  const normalizedHostname = hostname.trim().toLowerCase();
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname.endsWith(".localhost")
  );
};

export const isLocalDevelopmentUrl = (value: string): boolean => {
  try {
    return isLocalDevelopmentHostname(new URL(value).hostname);
  } catch {
    return false;
  }
};
