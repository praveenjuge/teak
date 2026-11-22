import { useLocation } from "@tanstack/react-router";
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
  switchLocale: (next: UiLocale) => Promise<void>;
}

const LocaleSwitchContext = createContext<LocaleSwitch | null>(null);

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

  const requestedLocale = useLocation({
    select: (location) => location.search[PSEUDO_LOCALE_PARAM],
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
    if (requestedLocale === PSEUDO_LOCALE) {
      switchLocale(PSEUDO_LOCALE).catch(() => undefined);
    }
  }, [requestedLocale, switchLocale]);

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

export const useLocaleSwitch = (): LocaleSwitch | null =>
  useContext(LocaleSwitchContext);
