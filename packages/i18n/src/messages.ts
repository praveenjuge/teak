import en from "../messages/en.json";
import { type Locale, PSEUDO_LOCALE, type UiLocale } from "./locales";

/** The English catalog's shape; every other catalog has the same keys. */
export type Messages = typeof en;

/** A language's catalog, which may lack keys while a change is in review. */
export type PartialMessages = DeepPartial<Messages>;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? T[K] : DeepPartial<T[K]>;
};

export const englishMessages: Messages = en;

interface CatalogModule {
  default: PartialMessages;
}

// One chunk per language, so English readers never download the others.
const catalogLoaders: Record<
  Exclude<Locale, "en">,
  () => Promise<CatalogModule>
> = {
  de: () => import("../messages/de.json"),
  es: () => import("../messages/es.json"),
  fr: () => import("../messages/fr.json"),
  ja: () => import("../messages/ja.json"),
  ko: () => import("../messages/ko.json"),
  "pt-BR": () => import("../messages/pt-BR.json"),
  "zh-Hans": () => import("../messages/zh-Hans.json"),
};

/**
 * The catalog for a UI locale. A language's catalog may lack a key while a
 * change is in review; English fills it in at render time.
 */
export const loadMessages = async (
  locale: UiLocale
): Promise<PartialMessages> => {
  if (locale === "en") {
    return englishMessages;
  }
  if (locale === PSEUDO_LOCALE) {
    const { pseudoLocalizeMessages } = await import("./pseudo");
    return pseudoLocalizeMessages(englishMessages);
  }
  return (await catalogLoaders[locale]()).default;
};
