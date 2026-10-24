import { LOCALE_COOKIE, resolveUiLocale, type UiLocale } from "@teak/i18n";

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The pseudo-locale is for development only; production ignores it. */
export const allowPseudoLocale = process.env.NODE_ENV !== "production";

/** The UI locale a stored cookie value asks for. */
export const localeFromCookie = (value: string | undefined): UiLocale =>
  resolveUiLocale(value, { allowPseudo: allowPseudoLocale });

/** Saves the locale for the next server render. Client only. */
export const writeLocaleCookie = (locale: UiLocale) => {
  // biome-ignore lint/suspicious/noDocumentCookie: the server reads this cookie on the next render, which Cookie Store can't promise in every browser.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
};

/** The locale the cookie asks for, read in the browser. */
export const readLocaleCookie = (): UiLocale => {
  const prefix = `${LOCALE_COOKIE}=`;
  const entry = document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix));
  return localeFromCookie(entry?.slice(prefix.length));
};

/** Forgets the locale, as on sign-out. Client only. */
export const clearLocaleCookie = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: see writeLocaleCookie.
  document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0; samesite=lax`;
};

/** `?__locale=en-XA` turns the pseudo-locale on in development. */
export const PSEUDO_LOCALE_PARAM = "__locale";
