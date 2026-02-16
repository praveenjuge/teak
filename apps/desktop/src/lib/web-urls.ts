const DEV_WEB_URL = "http://localhost:3000";
const PROD_WEB_URL = "https://app.teakvault.com";

function normalizeBaseUrl(rawUrl: string | undefined): string {
  const fallback = import.meta.env.DEV ? DEV_WEB_URL : PROD_WEB_URL;
  const candidate = rawUrl?.trim() ? rawUrl.trim() : fallback;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidate);
  } catch {
    parsedUrl = new URL(fallback);
  }

  parsedUrl.pathname = "";
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString().replace(/\/$/, "");
}

const WEB_URL = normalizeBaseUrl(import.meta.env.VITE_WEB_URL);

export function getWebUrl(): string {
  return WEB_URL;
}

export function buildWebUrl(pathname: string): string {
  const base = new URL(WEB_URL);
  base.pathname = pathname;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function getSignUpUrl(): string {
  return buildWebUrl("/register");
}

export function getForgotPasswordUrl(): string {
  return buildWebUrl("/forgot-password");
}

export function getCardViewUrl(cardId: string): string {
  return buildWebUrl(`/card/${cardId}`);
}
