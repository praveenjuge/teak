import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  flattenCatalog,
  messageSignature,
} from "../../packages/i18n/src/catalog";
import { SUPPORTED_LOCALES } from "../../packages/i18n/src/locales";
import {
  parseNativeMessage,
  SHARED_WEB_NAMESPACES,
} from "../../packages/i18n/src/native";
import { pseudoLocalize } from "../../packages/i18n/src/pseudo";

const MESSAGES_DIR = join(import.meta.dir, "../../packages/i18n/messages");
const NATIVE_DIR = join(MESSAGES_DIR, "native");

const readCatalog = (dir: string, file: string) =>
  flattenCatalog(JSON.parse(readFileSync(join(dir, file), "utf8")));

const translations = SUPPORTED_LOCALES.filter((locale) => locale !== "en");

// The web and extension catalogs, and the native apps' own catalogs.
for (const [name, dir] of [
  ["web", MESSAGES_DIR],
  ["native", NATIVE_DIR],
] as const) {
  const english = readCatalog(dir, "en.json");
  const readLocale = (locale: string) => readCatalog(dir, `${locale}.json`);

  describe(`${name} i18n catalogs`, () => {
    test("there is one catalog per supported language and no others", () => {
      const files = readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .sort();
      expect(files).toEqual(
        SUPPORTED_LOCALES.map((locale) => `${locale}.json`).sort()
      );
    });

    test("English is valid ICU", () => {
      const invalid = [...english].flatMap(([key, message]) => {
        try {
          messageSignature(message);
          return [];
        } catch (error) {
          return [`${key}: ${(error as Error).message}`];
        }
      });
      expect(invalid).toEqual([]);
    });

    for (const locale of translations) {
      describe(locale, () => {
        const catalog = readLocale(locale);

        test("has every English key and no others", () => {
          const missing = [...english.keys()].filter(
            (key) => !catalog.has(key)
          );
          const extra = [...catalog.keys()].filter((key) => !english.has(key));
          expect({ missing, extra }).toEqual({ missing: [], extra: [] });
        });

        test("keeps English placeholders, plurals and tags in valid ICU", () => {
          const mismatched = [...catalog].flatMap(([key, message]) => {
            const source = english.get(key);
            if (source === undefined) {
              return [];
            }
            try {
              const expected = messageSignature(source);
              const actual = messageSignature(message);
              return Bun.deepEquals(actual, expected)
                ? []
                : [`${key}: expected ${expected.join(", ")}; got ${actual}`];
            } catch (error) {
              return [`${key}: ${(error as Error).message}`];
            }
          });
          expect(mismatched).toEqual([]);
        });

        test("translates rather than copying English", () => {
          // Short words can match (OK, PDF), but most of a catalog must differ.
          const copied = [...catalog].filter(
            ([key, message]) =>
              message.length > 12 && message === english.get(key)
          );
          expect(copied.length).toBeLessThan(english.size * 0.1);
        });
      });
    }
  });
}

describe("native text", () => {
  const web = readCatalog(MESSAGES_DIR, "en.json");
  const shared = (key: string) =>
    SHARED_WEB_NAMESPACES.some((namespace) => key.startsWith(`${namespace}.`));

  test("the native catalogs hold only the native, apple and android namespaces", () => {
    const english = readCatalog(NATIVE_DIR, "en.json");
    const outside = [...english.keys()].filter(
      (key) => !/^(native|apple|android)\./.test(key)
    );
    expect(outside).toEqual([]);
  });

  test("every shared web namespace exists", () => {
    const missing = SHARED_WEB_NAMESPACES.filter(
      (namespace) =>
        ![...web.keys()].some((key) => key.startsWith(`${namespace}.`))
    );
    expect(missing).toEqual([]);
  });

  // Apple's string catalogs and Android's resources have no select or rich
  // text, and Android plurals take one count per message.
  for (const locale of SUPPORTED_LOCALES) {
    test(`${locale} uses only placeholders and one plural`, () => {
      const messages = [
        ...readCatalog(NATIVE_DIR, `${locale}.json`),
        ...[...readCatalog(MESSAGES_DIR, `${locale}.json`)].filter(([key]) =>
          shared(key)
        ),
      ];
      const unsupported = messages.flatMap(([key, message]) => {
        try {
          parseNativeMessage(message);
          return [];
        } catch (error) {
          return [`${key}: ${(error as Error).message}`];
        }
      });
      expect(unsupported).toEqual([]);
    });
  }
});

describe("pseudo-locale", () => {
  test("accents, pads and brackets text while keeping ICU working", () => {
    expect(pseudoLocalize("Save")).toBe("[Šávé ~~]");
    expect(
      pseudoLocalize("{count, plural, one {# card} other {# cards}}")
    ).toBe("[{count,plural,one{# çáŕð} other{# çáŕðš}} ~~]");
    expect(pseudoLocalize("Read the <link>docs</link>")).toBe(
      "[Réáð ţĥé <link>ðöçš</link> ~~~~~]"
    );
  });

  test("every English message survives pseudo-localization", () => {
    const english = readCatalog(MESSAGES_DIR, "en.json");
    const changed = [...english].filter(
      ([, message]) =>
        !Bun.deepEquals(
          messageSignature(pseudoLocalize(message)),
          messageSignature(message)
        )
    );
    expect(changed).toEqual([]);
  });
});
