export const SUPPORTED_LOCALES = [
  "en",
  "es",
  "pt-BR",
  "de",
  "fr",
  "ja",
  "ko",
  "zh-Hans",
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const PSEUDO_LOCALE = "en-XA";

export type UiLocale = Locale | typeof PSEUDO_LOCALE;

export const LOCALE_COOKIE = "teak-locale";

export const isSupportedLocale = (value: unknown): value is Locale =>
  typeof value === "string" &&
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

export const resolveUiLocale = (
  value: unknown,
  { allowPseudo = false }: { allowPseudo?: boolean } = {}
): UiLocale => {
  if (allowPseudo && value === PSEUDO_LOCALE) {
    return PSEUDO_LOCALE;
  }
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
};

export const LOCALE_NAMES: Record<Locale, { english: string; native: string }> =
  {
    en: { native: "English", english: "English" },
    es: { native: "Español", english: "Spanish" },
    "pt-BR": { native: "Português (Brasil)", english: "Portuguese (Brazil)" },
    de: { native: "Deutsch", english: "German" },
    fr: { native: "Français", english: "French" },
    ja: { native: "日本語", english: "Japanese" },
    ko: { native: "한국어", english: "Korean" },
    "zh-Hans": { native: "简体中文", english: "Chinese (Simplified)" },
  };

export const htmlLang = (locale: UiLocale): string =>
  locale === PSEUDO_LOCALE ? "en" : locale;

/**
 * The locale `Intl` formats with. English keeps whatever the caller used
 * before Teak was translated (the browser's locale when it passed none, or
 * a fixed one such as `en-US`), so English output doesn't change.
 */
export const intlLocale = (
  locale: UiLocale,
  englishLocale?: string
): string | undefined =>
  locale === "en" || locale === PSEUDO_LOCALE ? englishLocale : locale;

/** WebExtension `_locales` folder names differ from BCP 47 for two locales. */
export const extensionLocaleDir = (locale: Locale): string => {
  if (locale === "pt-BR") {
    return "pt_BR";
  }
  if (locale === "zh-Hans") {
    return "zh_CN";
  }
  return locale;
};
