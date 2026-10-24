import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flattenCatalog, messageSignature } from "../packages/i18n/src/catalog";
import { SUPPORTED_LOCALES } from "../packages/i18n/src/locales";
import { pseudoLocalize } from "../packages/i18n/src/pseudo";

const MESSAGES_DIR = join(import.meta.dir, "../packages/i18n/messages");

const readCatalog = (file: string) =>
  flattenCatalog(JSON.parse(readFileSync(join(MESSAGES_DIR, file), "utf8")));

const english = readCatalog("en.json");
const translations = SUPPORTED_LOCALES.filter((locale) => locale !== "en");

describe("i18n catalogs", () => {
  test("there is one catalog per supported language and no others", () => {
    const files = readdirSync(MESSAGES_DIR)
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
      const catalog = readCatalog(`${locale}.json`);

      test("has every English key and no others", () => {
        const missing = [...english.keys()].filter((key) => !catalog.has(key));
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

describe("pseudo-locale", () => {
  test("accents, pads and brackets text while keeping ICU working", () => {
    expect(pseudoLocalize("Save")).toBe("[Šávé ~~]");
    expect(
      pseudoLocalize("{count, plural, one {# card} other {# cards}}")
    ).toBe("[{count,plural,one{# çáŕð} other{# çáŕðš}} ~~~~~~~~~~~~~~~~~~]");
    expect(pseudoLocalize("Read the <link>docs</link>")).toBe(
      "[Réáð ţĥé <link>ðöçš</link> ~~~~~~~~~~]"
    );
  });

  test("every English message survives pseudo-localization", () => {
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
