import { DEFAULT_LOCALE, type Locale } from "@teak/i18n";
import type { AppMessages } from "./i18n";

// Only the two namespaces the view reads are bundled, from every catalog.
const mcpApp = import.meta.glob<AppMessages["mcpApp"]>(
  "../../i18n/messages/*.json",
  { eager: true, import: "mcpApp" }
);
const cards = import.meta.glob<{ types: AppMessages["cards"]["types"] }>(
  "../../i18n/messages/*.json",
  { eager: true, import: "cards" }
);

const pathFor = (locale: Locale) => `../../i18n/messages/${locale}.json`;

export const loadAppMessages = (locale: Locale): AppMessages => {
  const english = pathFor(DEFAULT_LOCALE);
  const own = pathFor(locale);
  return {
    cards: {
      types: { ...cards[english]?.types, ...cards[own]?.types },
    } as AppMessages["cards"],
    mcpApp: { ...mcpApp[english], ...mcpApp[own] } as AppMessages["mcpApp"],
  };
};
