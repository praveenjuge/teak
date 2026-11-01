import {
  createTeakTranslator,
  englishMessages,
  type TeakNamespace,
  type TeakTranslator,
} from "@teak/i18n";
import type { ErrorsTranslator } from "./serverErrors";

export const englishTranslator = <const N extends TeakNamespace>(
  namespace: N
): TeakTranslator<N> => createTeakTranslator("en", englishMessages, namespace);

export const englishErrors: ErrorsTranslator = englishTranslator("errors");

// biome-ignore lint/plugin: the one place this English default is written down.
export const US_ENGLISH_LOCALE = "en-US";
