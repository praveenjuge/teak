import {
  createTeakTranslator,
  DEFAULT_LOCALE,
  englishMessages,
  isSupportedLocale,
  loadMessages,
  type Messages,
  PSEUDO_LOCALE,
  resolveUiLocale,
  type TeakTranslator,
  type UiLocale,
  withEnglishFallback,
} from "@teak/i18n";

/** The account's language, as `/v1/me` last reported it. Kept after sign-out. */
export const LOCALE_KEY = "teakLocale";
export const LOCALE_OVERRIDE_KEY = "teakLocaleOverride";

const IS_DEV = Boolean(import.meta.env.DEV);

interface LocaleOptions {
  allowPseudo?: boolean;
}

export async function readUiLocale({
  allowPseudo = IS_DEV,
}: LocaleOptions = {}): Promise<UiLocale> {
  const [stored, override] = await Promise.all([
    chrome.storage.local.get(LOCALE_KEY),
    allowPseudo
      ? chrome.storage.local.get(LOCALE_OVERRIDE_KEY)
      : Promise.resolve({} as Record<string, unknown>),
  ]);
  if (allowPseudo && override[LOCALE_OVERRIDE_KEY] === PSEUDO_LOCALE) {
    return PSEUDO_LOCALE;
  }
  return resolveUiLocale(stored[LOCALE_KEY]);
}

export async function rememberAccountLocale(value: unknown): Promise<void> {
  if (value === undefined || value === null) {
    return;
  }
  const locale = isSupportedLocale(value) ? value : DEFAULT_LOCALE;
  const stored = (await chrome.storage.local.get(LOCALE_KEY))[LOCALE_KEY];
  // Writing only a change keeps the menus from rebuilding on every popup.
  if (stored !== locale) {
    await chrome.storage.local.set({ [LOCALE_KEY]: locale });
  }
}

export async function setPseudoLocale(on: boolean): Promise<void> {
  if (on) {
    await chrome.storage.local.set({ [LOCALE_OVERRIDE_KEY]: PSEUDO_LOCALE });
  } else {
    await chrome.storage.local.remove(LOCALE_OVERRIDE_KEY);
  }
}

export const isLocaleChange = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
): boolean =>
  areaName === "local" &&
  (LOCALE_KEY in changes || LOCALE_OVERRIDE_KEY in changes);

export function onLocaleChange(listener: () => void): () => void {
  const handle = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (isLocaleChange(changes, areaName)) {
      listener();
    }
  };
  chrome.storage.onChanged.addListener(handle);
  return () => chrome.storage.onChanged.removeListener(handle);
}

export const localeMessages = async (locale: UiLocale): Promise<Messages> =>
  withEnglishFallback(await loadMessages(locale));

export interface BackgroundStrings {
  contextMenu: TeakTranslator<"extension.contextMenu">;
  inline: TeakTranslator<"extension.inline">;
  locale: UiLocale;
  omnibox: TeakTranslator<"extension.omnibox">;
}

export const backgroundStrings = (
  locale: UiLocale,
  messages: Messages
): BackgroundStrings => ({
  contextMenu: createTeakTranslator(locale, messages, "extension.contextMenu"),
  inline: createTeakTranslator(locale, messages, "extension.inline"),
  locale,
  omnibox: createTeakTranslator(locale, messages, "extension.omnibox"),
});

export const ENGLISH_STRINGS = backgroundStrings(
  DEFAULT_LOCALE,
  englishMessages
);

export function createBackgroundLocale({
  allowPseudo = IS_DEV,
  onChange,
}: LocaleOptions & { onChange?: (strings: BackgroundStrings) => void } = {}) {
  let current = ENGLISH_STRINGS;
  let generation = 0;
  const load = async () => {
    generation += 1;
    const mine = generation;
    try {
      const locale = await readUiLocale({ allowPseudo });
      const next = backgroundStrings(locale, await localeMessages(locale));
      // A later change may have finished first; it wins.
      if (mine === generation) {
        current = next;
      }
    } catch {
      // Keep the strings already shown.
    }
    return current;
  };
  let ready = load();
  const stop = onLocaleChange(() => {
    ready = load();
    void ready.then((strings) => onChange?.(strings));
  });
  return {
    get current() {
      return current;
    },
    ready: () => ready,
    stop,
  };
}
