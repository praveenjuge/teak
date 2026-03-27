import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";

const PROD_WEB_URL = "https://app.teakvault.com";

type DesktopConfigEnv = {
  DEV: boolean;
  VITE_PUBLIC_CONVEX_SITE_URL?: string;
  VITE_PUBLIC_CONVEX_URL?: string;
  VITE_WEB_URL?: string;
};

function normalizeBaseUrl(label: string, rawUrl: string): string {
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
}

function resolveRequiredBaseUrl(label: string, rawUrl: string | undefined) {
  if (!rawUrl?.trim()) {
    throw new Error(`Missing ${label} in desktop environment`);
  }

  return normalizeBaseUrl(label, rawUrl.trim());
}

function resolveWebBaseUrl(rawUrl: string | undefined, isDev: boolean) {
  if (!rawUrl?.trim()) {
    const fallback = isDev
      ? resolveTeakDevAppUrl(import.meta.env)
      : PROD_WEB_URL;
    return normalizeBaseUrl("VITE_WEB_URL", fallback);
  }

  return normalizeBaseUrl("VITE_WEB_URL", rawUrl.trim());
}

export function resolveDesktopConfig(env: DesktopConfigEnv) {
  const webBaseUrl = resolveWebBaseUrl(env.VITE_WEB_URL, env.DEV);

  return {
    buildWebUrl(pathname: string) {
      const url = new URL(webBaseUrl);
      url.pathname = pathname;
      url.search = "";
      url.hash = "";
      return url.toString();
    },
    convexSiteBaseUrl: resolveRequiredBaseUrl(
      "VITE_PUBLIC_CONVEX_SITE_URL",
      env.VITE_PUBLIC_CONVEX_SITE_URL
    ),
    convexUrl: resolveRequiredBaseUrl(
      "VITE_PUBLIC_CONVEX_URL",
      env.VITE_PUBLIC_CONVEX_URL
    ),
    webBaseUrl,
  } as const;
}

let cachedDesktopConfig: ReturnType<typeof resolveDesktopConfig> | null = null;

export function getDesktopConfig() {
  if (cachedDesktopConfig) {
    return cachedDesktopConfig;
  }

  cachedDesktopConfig = resolveDesktopConfig({
    DEV: import.meta.env.DEV,
    VITE_PUBLIC_CONVEX_SITE_URL: import.meta.env.VITE_PUBLIC_CONVEX_SITE_URL,
    VITE_PUBLIC_CONVEX_URL: import.meta.env.VITE_PUBLIC_CONVEX_URL,
    VITE_WEB_URL: import.meta.env.VITE_WEB_URL,
  });

  return cachedDesktopConfig;
}

export function buildWebUrl(pathname: string) {
  return getDesktopConfig().buildWebUrl(pathname);
}
