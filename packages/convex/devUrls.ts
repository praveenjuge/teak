export const TEAK_DEV_DEPLOYMENT_NAME = "reminiscent-kangaroo-59";
export const DEFAULT_TEAK_DEV_APP_URL = "http://localhost:3000";
export const DEFAULT_TEAK_DEV_CONVEX_URL = `https://${TEAK_DEV_DEPLOYMENT_NAME}.convex.cloud`;
export const DEFAULT_TEAK_DEV_CONVEX_SITE_URL = `https://${TEAK_DEV_DEPLOYMENT_NAME}.convex.site`;
export const DEFAULT_TEAK_DEV_API_URL = DEFAULT_TEAK_DEV_CONVEX_SITE_URL;
export const DEFAULT_TEAK_DEV_DOCS_URL = "http://localhost:3001";

export interface DevUrlEnv {
  TEAK_DEV_API_URL?: unknown;
  TEAK_DEV_APP_URL?: unknown;
  TEAK_DEV_DOCS_URL?: unknown;
  [key: string]: unknown;
}

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
