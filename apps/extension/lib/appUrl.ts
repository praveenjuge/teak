import { resolveTeakDevAppUrl } from "@teak/convex/devUrls";

export const APP_URL = import.meta.env.DEV
  ? resolveTeakDevAppUrl(import.meta.env)
  : "https://app.teakvault.com";
