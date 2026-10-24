import {
  createTeakTranslator,
  englishMessages,
  type TeakNamespace,
  type TeakTranslator,
} from "@teak/i18n";
import {
  type ErrorsTranslator,
  keyByEnglishMessage,
  translateErrorKey,
} from "./serverErrors";

/**
 * An English translator for one namespace: the default for helpers outside
 * React, so a caller that passes no translator gets the English text.
 */
export const englishTranslator = <const N extends TeakNamespace>(
  namespace: N
): TeakTranslator<N> => createTeakTranslator("en", englishMessages, namespace);

export const englishErrors: ErrorsTranslator = englishTranslator("errors");

/**
 * The fixed locale some helpers formatted English dates with before
 * translation. Their callers pass `useIntlLocale(US_ENGLISH_LOCALE)`, which
 * keeps it in English and uses the UI language otherwise.
 */
// biome-ignore lint/plugin: the one place this English default is written down.
export const US_ENGLISH_LOCALE = "en-US";

/**
 * A message the server sent in English, in the UI language when the catalog
 * knows it, else as sent.
 */
export const translateServerMessage = (
  t: ErrorsTranslator,
  message: string
): string => {
  const key = keyByEnglishMessage.get(message);
  return key ? translateErrorKey(t, key) : message;
};
