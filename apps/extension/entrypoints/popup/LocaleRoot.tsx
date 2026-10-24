import {
  DEFAULT_LOCALE,
  englishMessages,
  htmlLang,
  type Messages,
  PSEUDO_LOCALE,
  type UiLocale,
} from "@teak/i18n";
import { I18nProvider, useTranslations, useUiLocale } from "@teak/i18n/react";
import { type ReactNode, useEffect, useState } from "react";
import {
  localeMessages,
  onLocaleChange,
  readUiLocale,
  setPseudoLocale,
} from "../../lib/locale";

export interface PopupLocale {
  locale: UiLocale;
  messages: Messages;
}

/**
 * The stored language and its catalog. `index.html` says `lang="en"`, so
 * this sets the document's language once it is known.
 */
export async function loadPopupLocale(): Promise<PopupLocale> {
  let loaded: PopupLocale;
  try {
    const locale = await readUiLocale();
    loaded = { locale, messages: await localeMessages(locale) };
  } catch {
    loaded = { locale: DEFAULT_LOCALE, messages: englishMessages };
  }
  document.documentElement.lang = htmlLang(loaded.locale);
  return loaded;
}

/**
 * The popup in the account's language. It follows a change while open, such
 * as the one `/v1/me` brings right after sign-in.
 */
export function LocaleRoot({
  children,
  initial,
}: {
  children: ReactNode;
  initial: PopupLocale;
}) {
  const [current, setCurrent] = useState(initial);
  useEffect(() => {
    let latest = 0;
    return onLocaleChange(() => {
      latest += 1;
      const request = latest;
      void loadPopupLocale().then((loaded) => {
        if (request === latest) {
          setCurrent(loaded);
        }
      });
    });
  }, []);
  return (
    <I18nProvider locale={current.locale} messages={current.messages}>
      {children}
      {import.meta.env.DEV ? <DevMenu /> : null}
    </I18nProvider>
  );
}

/** Development builds only: switches the popup, menus and omnibox to `en-XA`. */
function DevMenu() {
  const t = useTranslations("extension.popup");
  const pseudo = useUiLocale() === PSEUDO_LOCALE;
  return (
    <label className="flex items-center justify-center gap-2 border-t border-dashed py-1.5 text-muted-foreground text-xs">
      <input
        checked={pseudo}
        onChange={(event) => {
          void setPseudoLocale(event.target.checked);
        }}
        type="checkbox"
      />
      {t("pseudoLocale")}
    </label>
  );
}
