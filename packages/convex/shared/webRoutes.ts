/**
 * The web app's paths and URL params that other surfaces link to: the public
 * API's `appUrl` and `settingsUrl`, the extension, the docs site. Released
 * apps and published links depend on them, so a value here never changes.
 * Raycast and the Apple app can't import this and keep their own copies.
 */

/** The library param that names the open card: `/?card=<id>`. */
export const CARD_PARAM = "card";

export const TAGS_PATH = "/tags";

export const SETTINGS_PATHS = {
  account: "/settings",
  plan: "/settings/plan",
  appearance: "/settings/appearance",
  integrations: "/settings/integrations",
  security: "/settings/security",
  data: "/settings/data",
} as const;

export type SettingsSectionId = keyof typeof SETTINGS_PATHS;

/** The routes that start hosted sign-in and sign-up. */
export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";

/** The library at `base` with this card open. */
export const cardAppUrl = (base: string, cardId: string): string => {
  const url = new URL(base);
  url.searchParams.set(CARD_PARAM, cardId);
  return url.toString();
};
