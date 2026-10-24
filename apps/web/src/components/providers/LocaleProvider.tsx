"use client";

import {
  htmlLang,
  loadMessages,
  type PartialMessages,
  PSEUDO_LOCALE,
  type UiLocale,
} from "@teak/i18n";
import { I18nProvider } from "@teak/i18n/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  allowPseudoLocale,
  PSEUDO_LOCALE_PARAM,
  writeLocaleCookie,
} from "@/lib/locale";

interface LocaleSwitch {
  locale: UiLocale;
  /** Loads the language's catalog, then renders the app in it. */
  switchLocale: (next: UiLocale) => Promise<void>;
}

const LocaleSwitchContext = createContext<LocaleSwitch | null>(null);

/**
 * The signed-in app's language. The server picks it from the cookie for the
 * first render; switching loads the new catalog and swaps it in place.
 */
export function LocaleProvider({
  children,
  initialLocale,
  initialMessages,
}: {
  children: ReactNode;
  initialLocale: UiLocale;
  initialMessages: PartialMessages;
}) {
  const [state, setState] = useState({
    locale: initialLocale,
    messages: initialMessages,
  });

  const switchLocale = useCallback(async (next: UiLocale) => {
    const messages = await loadMessages(next);
    writeLocaleCookie(next);
    setState({ locale: next, messages });
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLang(state.locale);
  }, [state.locale]);

  useEffect(() => {
    if (!allowPseudoLocale) {
      return;
    }
    const requested = new URLSearchParams(window.location.search).get(
      PSEUDO_LOCALE_PARAM
    );
    if (requested === PSEUDO_LOCALE) {
      switchLocale(PSEUDO_LOCALE).catch(() => undefined);
    }
  }, [switchLocale]);

  const value = useMemo(
    () => ({ locale: state.locale, switchLocale }),
    [state.locale, switchLocale]
  );

  return (
    <LocaleSwitchContext.Provider value={value}>
      <I18nProvider locale={state.locale} messages={state.messages}>
        {children}
      </I18nProvider>
    </LocaleSwitchContext.Provider>
  );
}

/** Switching the language, for the Settings row and account sync. */
export const useLocaleSwitch = (): LocaleSwitch | null =>
  useContext(LocaleSwitchContext);
