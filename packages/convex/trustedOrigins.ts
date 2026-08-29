import {
  type DevUrlEnv,
  isLocalDevelopmentUrl,
  resolveTeakDevAppUrl,
} from "./devUrls";

const DESKTOP_DEV_ORIGINS = ["http://localhost:1420", "http://127.0.0.1:1420"];
const PRODUCTION_APP_ORIGIN = "https://app.teakvault.com";
const CHROME_EXTENSION_ORIGIN =
  "chrome-extension://negnmfifahnnagnbnfppmlgfajngdpob";

export const EXACT_TEAK_CALLBACK_URL = "teak://";

export const buildTrustedOrigins = (
  siteUrl: string,
  env: DevUrlEnv = process.env
): string[] => {
  const origins = [
    siteUrl,
    "https://*.teakvault.com",
    PRODUCTION_APP_ORIGIN,
    EXACT_TEAK_CALLBACK_URL,
    CHROME_EXTENSION_ORIGIN,
    "https://appleid.apple.com",
  ];

  if (!isLocalDevelopmentUrl(siteUrl)) {
    return origins;
  }

  return [
    ...origins,
    resolveTeakDevAppUrl(env),
    ...DESKTOP_DEV_ORIGINS,
    "exp+teak://*",
    "exp://*/*",
    "exp://10.0.0.*:*/*",
    "exp://192.168.*.*:*/*",
    "exp://172.*.*.*:*/*",
    "exp://localhost:*/*",
  ];
};
