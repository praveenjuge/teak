import { describe, expect, test } from "bun:test";
import {
  createTeakTranslator,
  englishMessages,
  intlLocale,
  loadMessages,
  resolveUiLocale,
  withEnglishFallback,
} from "../index";
import { pseudoLocalize } from "../pseudo";

describe("locales", () => {
  test("unknown values fall back to English; the pseudo-locale needs opting in", () => {
    expect(resolveUiLocale("de")).toBe("de");
    expect(resolveUiLocale("xx")).toBe("en");
    expect(resolveUiLocale(undefined)).toBe("en");
    expect(resolveUiLocale("en-XA")).toBe("en");
    expect(resolveUiLocale("en-XA", { allowPseudo: true })).toBe("en-XA");
  });

  test("English formats with the locale the caller used before", () => {
    expect(intlLocale("en", "en-US")).toBe("en-US");
    expect(intlLocale("en")).toBeUndefined();
    expect(intlLocale("en-XA", "en-US")).toBe("en-US");
    expect(intlLocale("de", "en-US")).toBe("de");
  });
});

describe("translator", () => {
  test("a language's missing key shows English", () => {
    const messages = withEnglishFallback({ common: { save: "Speichern" } });
    const t = createTeakTranslator("de", messages, "common");
    expect(t("save")).toBe("Speichern");
    expect(t("cancel")).toBe(englishMessages.common.cancel);
  });

  test("English loads without a separate chunk", async () => {
    expect(await loadMessages("en")).toBe(englishMessages);
  });
});

describe("pseudo-locale", () => {
  test("wraps, accents and lengthens text but keeps ICU syntax", () => {
    const out = pseudoLocalize(
      "{count, plural, one {# card} other {# cards}} in <b>{name}</b>"
    );
    expect(out.startsWith("[")).toBe(true);
    expect(out.endsWith("]")).toBe(true);
    expect(out).toContain("{name}");
    expect(out).toContain("<b>");
    expect(out).toContain("çáŕð");
    const t = createTeakTranslator("en-XA", { m: out } as never);
    expect(
      (t as unknown as (k: string, v: object) => string)("m", {
        count: 2,
        name: "X",
        b: (c: string) => c,
      })
    ).toContain("2");
  });

  test("the pseudo catalog keeps every key", async () => {
    const pseudo = await loadMessages("en-XA");
    expect(Object.keys(pseudo)).toEqual(Object.keys(englishMessages));
    expect(pseudo.common?.save).toMatch(/^\[Šávé ~+\]$/);
  });
});
