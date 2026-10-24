import { describe, expect, test } from "bun:test";
import { formatBytes } from "@teak/convex/shared/utils/formatBytes";
import { parseTimeSearchQuery } from "@teak/convex/shared/utils/timeSearch";
import { createTeakTranslator, withEnglishFallback } from "@teak/i18n";
import de from "@teak/i18n/messages/de.json";
import { timeFilterLabel } from "../timeFilterLabel";

const NOW = new Date(2026, 9, 21, 12);
const german = createTeakTranslator(
  "de",
  withEnglishFallback(de),
  "search.dates"
);

const filter = (words: string) => {
  const parsed = parseTimeSearchQuery(words, { now: NOW });
  if (!parsed) {
    throw new Error(`no date in "${words}"`);
  }
  return parsed;
};

describe("timeFilterLabel", () => {
  test("English keeps the label the search parser wrote", () => {
    const thisWeek = filter("this week");
    expect(
      timeFilterLabel(thisWeek, german, { english: true, locale: undefined })
    ).toBe(thisWeek.label);
  });

  test("other languages name the date words and format dates", () => {
    const options = { english: false, locale: "de" };
    expect(timeFilterLabel(filter("this week"), german, options)).toBe(
      "Diese Woche"
    );
    expect(timeFilterLabel(filter("last monday"), german, options)).toBe(
      "Letzten Montag"
    );
    expect(timeFilterLabel(filter("2026-10-01"), german, options)).toBe(
      "01.10.2026"
    );
  });
});

describe("formatBytes", () => {
  test("keeps the English form without a locale and writes the number in one", () => {
    expect(formatBytes(2.1 * 1024 * 1024)).toBe("2.1 MB");
    expect(formatBytes(2.1 * 1024 * 1024, "en-US")).toBe("2.1 MB");
    expect(formatBytes(2.1 * 1024 * 1024, "de")).toBe("2,1 MB");
    expect(formatBytes(1023, "de")).toBe("1023 B");
  });
});
