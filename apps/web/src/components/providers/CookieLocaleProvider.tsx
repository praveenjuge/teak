"use client";

import {
  englishMessages,
  htmlLang,
  loadMessages,
  type PartialMessages,
  type UiLocale,
} from "@teak/i18n";
import { I18nProvider } from "@teak/i18n/react";
import { type ReactNode, useEffect, useState } from "react";
import { readLocaleCookie } from "@/lib/locale";

/**
 * The language for pages outside the signed-in app (the 404 page and the
 * root error page), read from the cookie in the browser. They render in
 * English first, since the server renders them without the cookie.
 */
export function CookieLocaleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    locale: UiLocale;
    messages: PartialMessages;
  }>({ locale: "en", messages: englishMessages });

  useEffect(() => {
    const locale = readLocaleCookie();
    if (locale === "en") {
      return;
    }
    let active = true;
    loadMessages(locale)
      .then((messages) => {
        if (active) {
          setState({ locale, messages });
          document.documentElement.lang = htmlLang(locale);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <I18nProvider locale={state.locale} messages={state.messages}>
      {children}
    </I18nProvider>
  );
}
