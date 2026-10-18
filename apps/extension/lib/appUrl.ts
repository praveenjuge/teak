import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";

export const APP_URL = import.meta.env.DEV
  ? resolveTeakDevAppUrl(import.meta.env)
  : "https://app.teakvault.com";
