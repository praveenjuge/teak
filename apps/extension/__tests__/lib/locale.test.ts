/// <reference types="bun" />
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { createContextMenuBuilder } from "../../lib/contextMenus";
import {
  ENGLISH_INLINE_LABELS,
  inlineLabels,
  withReason,
} from "../../lib/inlineLabels";
import {
  createBackgroundLocale,
  LOCALE_KEY,
  LOCALE_OVERRIDE_KEY,
  readUiLocale,
  rememberAccountLocale,
  setPseudoLocale,
} from "../../lib/locale";
import { installChromeStorage } from "../helpers/chromeStorage";

type ChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => void;

const originalChrome = globalThis.chrome;
let items: Map<string, unknown>;
let listeners: Set<ChangeListener>;
let menus: { id?: string; title?: string; contexts?: string[] }[];

const store = (values: Record<string, unknown>) => {
  const changes: Record<string, chrome.storage.StorageChange> = {};
  for (const [key, value] of Object.entries(values)) {
    changes[key] = { oldValue: items.get(key), newValue: value };
    items.set(key, value);
  }
  for (const listener of listeners) {
    listener(changes, "local");
  }
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(() => {
  listeners = new Set();
  menus = [];
  items = installChromeStorage({
    contextMenus: {
      create: mock((properties: (typeof menus)[number]) => {
        menus.push(properties);
      }),
      removeAll: mock((done: () => void) => {
        menus = [];
        done();
      }),
    },
  });
  Object.assign(chrome.storage, {
    onChanged: {
      addListener: (listener: ChangeListener) => listeners.add(listener),
      removeListener: (listener: ChangeListener) => listeners.delete(listener),
    },
  });
});

afterEach(() => {
  globalThis.chrome = originalChrome;
});

describe("the account's language", () => {
  test("is stored from /v1/me and read back", async () => {
    await rememberAccountLocale("de");
    expect(items.get(LOCALE_KEY)).toBe("de");
    expect(await readUiLocale()).toBe("de");
  });

  test("a language this version doesn't know falls back to English", async () => {
    items.set(LOCALE_KEY, "de");
    await rememberAccountLocale("tlh");
    expect(items.get(LOCALE_KEY)).toBe("en");
    items.set(LOCALE_KEY, "tlh");
    expect(await readUiLocale()).toBe("en");
  });

  test("a /v1/me without one (an older server) keeps the stored language", async () => {
    items.set(LOCALE_KEY, "ja");
    await rememberAccountLocale(undefined);
    expect(items.get(LOCALE_KEY)).toBe("ja");
  });

  test("signed out with nothing stored is English", async () => {
    expect(await readUiLocale()).toBe("en");
  });

  test("writes only a change, so the menus don't rebuild on every popup", async () => {
    items.set(LOCALE_KEY, "fr");
    const set = spyOn(chrome.storage.local, "set");
    await rememberAccountLocale("fr");
    expect(set).not.toHaveBeenCalled();
  });

  test("the pseudo-locale override counts only in development", async () => {
    items.set(LOCALE_KEY, "ko");
    await setPseudoLocale(true);
    expect(items.get(LOCALE_OVERRIDE_KEY)).toBe("en-XA");
    expect(await readUiLocale({ allowPseudo: false })).toBe("ko");
    expect(await readUiLocale({ allowPseudo: true })).toBe("en-XA");
    await setPseudoLocale(false);
    expect(await readUiLocale({ allowPseudo: true })).toBe("ko");
  });
});

describe("context menus", () => {
  test("are built in English, then rebuilt when the language changes", async () => {
    const build = createContextMenuBuilder();
    const locale = createBackgroundLocale({
      allowPseudo: true,
      onChange: (strings) => void build(strings),
    });
    await build(await locale.ready());
    expect(menus.map((menu) => menu.title)).toEqual([
      "Save Page to Teak",
      "Save Asset to Teak",
      "Save Text to Teak",
    ]);

    store({ [LOCALE_OVERRIDE_KEY]: "en-XA" });
    await locale.ready();
    await settle();
    expect(menus.map((menu) => menu.id)).toEqual([
      "save-page",
      "save-asset",
      "save-text",
    ]);
    for (const menu of menus) {
      expect(menu.title).toMatch(/^\[.*Ţéáķ ~+\]$/u);
    }
    expect(locale.current.locale).toBe("en-XA");
    locale.stop();
  });

  test("ignore storage changes that aren't the language", async () => {
    const onChange = mock();
    const locale = createBackgroundLocale({ onChange });
    store({ teakOAuthState: { authenticated: true } });
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    locale.stop();
  });
});

describe("inline button labels", () => {
  test("English, with the background's translator, matches the fallback", async () => {
    const locale = createBackgroundLocale({ allowPseudo: false });
    const labels = inlineLabels((await locale.ready()).inline);
    expect(labels).toEqual(ENGLISH_INLINE_LABELS);
    expect(withReason(labels, "Sign in to Teak to save")).toBe(
      "Save failed. Retry: Sign in to Teak to save"
    );
    locale.stop();
  });
});
