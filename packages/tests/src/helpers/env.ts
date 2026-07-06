const trim = (value: string | undefined, fallback: string) =>
  (value?.trim() || fallback).replace(/\/+$/, "");

export const env = {
  appUrl: trim(process.env.PROD_APP_URL, "https://app.teakvault.com"),
  siteUrl: trim(process.env.PROD_SITE_URL, "https://teakvault.com"),
  apiUrl: trim(process.env.PROD_API_URL, "https://teakvault.com/api"),
  mcpUrl: trim(process.env.PROD_MCP_URL, "https://teakvault.com/mcp"),
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

export const uniqueEmail = (label = "primary") =>
  `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${env.emailDomain}`;
