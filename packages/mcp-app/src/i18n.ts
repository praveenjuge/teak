import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@teak/i18n";
import { createTranslator } from "use-intl/core";
import type en from "../../i18n/messages/en.json";

/** The catalog keys the view reads: its own text and the card type names. */
export interface AppMessages {
  cards: { types: (typeof en)["cards"]["types"] };
  mcpApp: (typeof en)["mcpApp"];
}

/**
 * The Teak language for a host's BCP 47 locale (`en-US`, `pt-BR`, `zh-CN`).
 * Chinese other than Simplified, and any language Teak isn't in, is English.
 */
export const resolveAppLocale = (hostLocale: string | undefined): Locale => {
  if (!hostLocale) {
    return DEFAULT_LOCALE;
  }
  if (isSupportedLocale(hostLocale)) {
    return hostLocale;
  }
  const [language, ...rest] = hostLocale.split(/[-_]/u);
  const lower = language?.toLowerCase();
  if (lower === "pt") {
    return "pt-BR";
  }
  if (lower === "zh") {
    const traditional = rest.some((part) =>
      ["hant", "tw", "hk", "mo"].includes(part.toLowerCase())
    );
    return traditional ? DEFAULT_LOCALE : "zh-Hans";
  }
  return isSupportedLocale(lower) ? lower : DEFAULT_LOCALE;
};

export const createAppTranslator = (locale: Locale, messages: AppMessages) =>
  createTranslator({
    locale,
    messages,
    namespace: "mcpApp",
    // Dates and numbers never go through messages here.
    onError: () => undefined,
  });

export type AppTranslator = ReturnType<typeof createAppTranslator>;

export const cardTypeLabel = (
  messages: AppMessages,
  type: keyof AppMessages["cards"]["types"]
): string => messages.cards.types[type];
