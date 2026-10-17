import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";

/** The Teak web app the popup links to and address-bar search opens. */
export const APP_URL = import.meta.env.DEV
  ? resolveTeakDevAppUrl(import.meta.env)
  : "https://app.teakvault.com";
