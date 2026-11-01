"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, intlLocale, type UiLocale } from "./locales";
import {
  englishMessages,
  type Messages,
  type PartialMessages,
} from "./messages";
import {
  createTeakTranslator,
  type TeakNamespace,
  withEnglishFallback,
} from "./translator";

interface I18nState {
  locale: UiLocale;
  messages: Messages;
}

const ENGLISH: I18nState = {
  locale: DEFAULT_LOCALE,
  messages: englishMessages,
};

const I18nContext = createContext<I18nState | null>(null);

/**
 * The UI language for everything below it. Without a provider (tests, a
 * screen outside the app shell) components render English.
 */
export function I18nProvider({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: UiLocale;
  messages: PartialMessages | Messages;
}) {
  const value = useMemo(
    () => ({ locale, messages: withEnglishFallback(messages) }),
    [locale, messages]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const useI18nState = () => useContext(I18nContext) ?? ENGLISH;

export const useUiLocale = (): UiLocale => useI18nState().locale;

export const useIntlLocale = (englishLocale?: string) =>
  intlLocale(useUiLocale(), englishLocale);

export function useTranslations<const N extends TeakNamespace = never>(
  namespace?: N
) {
  const { locale, messages } = useI18nState();
  return useMemo(
    () => createTeakTranslator<N>(locale, messages, namespace),
    [locale, messages, namespace]
  );
}
