const trim = (value: string | undefined, fallback: string) =>
  (value?.trim() || fallback).replace(/\/+$/, "");

const publicOrigin = trim(
  process.env.E2E_PUBLIC_ORIGIN,
  "https://teakvault.com"
);

export const env = {
  appUrl: trim(process.env.E2E_APP_ORIGIN, "https://app.teakvault.com"),
  siteUrl: publicOrigin,
  apiUrl: `${publicOrigin}/api`,
  mcpUrl: `${publicOrigin}/mcp`,
  convexUrl: trim(process.env.E2E_CONVEX_URL, ""),
  convexSiteUrl: trim(process.env.E2E_CONVEX_SITE_URL, ""),
  cleanupToken: process.env.E2E_CLEANUP_TOKEN ?? "",
  emailDeliveryEnabled: process.env.E2E_EMAIL_DELIVERY_ENABLED === "true",
  mailpitUrl: trim(process.env.MAILPIT_URL, ""),
  emailDomain: process.env.E2E_EMAIL_DOMAIN?.trim() || "",
  password: process.env.PROD_E2E_PASSWORD || "",
};

export const requirePassword = () => {
  if (!env.password) {
    throw new Error("PROD_E2E_PASSWORD is required");
  }
  return env.password;
};

export const requireMailpit = () => {
  if (!(env.mailpitUrl && env.emailDomain)) {
    throw new Error("MAILPIT_URL and E2E_EMAIL_DOMAIN secrets are required");
  }
};

export const requireE2ECleanup = () => {
  if (!(env.cleanupToken && env.convexSiteUrl)) {
    throw new Error("E2E_CLEANUP_TOKEN and E2E_CONVEX_SITE_URL are required");
  }
};

export const requireE2ENamespace = () => {
  if (!env.emailDomain) {
    throw new Error("E2E_EMAIL_DOMAIN is required");
  }
};

export const uniqueEmail = (label = "primary") =>
  `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${env.emailDomain}`;
