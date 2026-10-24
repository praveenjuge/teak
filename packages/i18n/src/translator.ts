import {
  createTranslator,
  type IntlError,
  IntlErrorCode,
  type NamespaceKeys,
  type NestedKeyOf,
} from "use-intl/core";
import { htmlLang, type UiLocale } from "./locales";
import {
  englishMessages,
  type Messages,
  type PartialMessages,
} from "./messages";

/** A namespace in the catalog, such as `"common"` or `"cardModal.menu"`. */
export type TeakNamespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

interface Catalog {
  [key: string]: string | Catalog;
}

const fillFrom = (fallback: Catalog, catalog: Catalog): Catalog =>
  Object.fromEntries(
    Object.entries(fallback).map(([key, value]) => {
      const own = catalog[key];
      if (typeof value === "string") {
        return [key, typeof own === "string" ? own : value];
      }
      return [key, fillFrom(value, own && typeof own === "object" ? own : {})];
    })
  );

/**
 * A language's catalog with English filling any key it lacks, so a missing
 * translation shows English rather than a key name.
 */
export const withEnglishFallback = (
  messages: PartialMessages | Messages
): Messages =>
  messages === englishMessages
    ? englishMessages
    : (fillFrom(englishMessages, messages as Catalog) as Messages);

const reportError = (error: IntlError) => {
  // Dates and numbers are formatted with Intl directly, never through
  // messages, so the missing time zone warning doesn't apply.
  if (error.code === IntlErrorCode.ENVIRONMENT_FALLBACK) {
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    console.error(error);
  }
};

/** A translator outside React: background scripts and plain helpers. */
export const createTeakTranslator = <const N extends TeakNamespace = never>(
  locale: UiLocale,
  messages: Messages,
  namespace?: N
) =>
  createTranslator<Messages, N>({
    locale: htmlLang(locale),
    messages,
    namespace,
    onError: reportError,
  });

export type TeakTranslator<N extends TeakNamespace = never> = ReturnType<
  typeof createTeakTranslator<N>
>;
