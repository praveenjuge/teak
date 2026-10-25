import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flattenCatalog } from "../../../../i18n/src/catalog";
import { SHARED_WEB_NAMESPACES } from "../../../../i18n/src/native";
import { SEARCH_QUALIFIER_KEYS } from "../../../shared/search/qualifiers";
import {
  SEARCH_EXCLUDE_HINTS,
  SEARCH_IS_OPTIONS,
  SEARCH_OR_HINT,
  SEARCH_QUALIFIER_HINTS,
  SEARCH_SUGGESTION_GROUP_MESSAGE_KEYS,
} from "../../../shared/search/suggestionHints";

const hints = [
  ...SEARCH_QUALIFIER_HINTS,
  ...SEARCH_EXCLUDE_HINTS,
  SEARCH_OR_HINT,
];

const messageKeys = [
  ...hints.map((hint) => hint.messageKey),
  ...SEARCH_IS_OPTIONS.map((option) => option.messageKey),
  ...Object.values(SEARCH_SUGGESTION_GROUP_MESSAGE_KEYS),
];

const repoFile = (path: string) =>
  readFileSync(join(import.meta.dir, "../../../../..", path), "utf8");

const english = flattenCatalog(
  JSON.parse(repoFile("packages/i18n/messages/en.json"))
);

describe("search suggestion hints", () => {
  test("every label is an English message the native apps can read", () => {
    expect(messageKeys.filter((key) => !english.has(key))).toEqual([]);
    const shared = (key: string) =>
      SHARED_WEB_NAMESPACES.some((namespace) =>
        key.startsWith(`${namespace}.`)
      );
    expect(messageKeys.filter((key) => !shared(key))).toEqual([]);
  });

  test("hints start real qualifiers, and only filters a `-` can leave out", () => {
    for (const hint of SEARCH_QUALIFIER_HINTS) {
      expect(SEARCH_QUALIFIER_KEYS).toContain(hint.key);
      expect(hint.insert).toBe(`${hint.key}:`);
    }
    for (const hint of SEARCH_EXCLUDE_HINTS) {
      expect(["like", "mood"]).not.toContain(hint.key);
      expect(hint.insert).toBe(`-${hint.key}:`);
    }
    expect(new Set(hints.map((hint) => hint.id)).size).toBe(hints.length);
  });

  // The web imports this file (its tests check what it builds from it). The
  // apps' generated constants must carry the same data; their drift tests
  // keep them regenerated.
  test("the Apple and Android apps ship the same hints", () => {
    const apple = JSON.parse(
      repoFile(
        "apps/apple/Packages/TeakKit/Sources/TeakCore/Resources/SharedConstants.json"
      )
    );
    expect(apple.searchSuggestionHints).toEqual({
      qualifiers: SEARCH_QUALIFIER_HINTS,
      exclude: SEARCH_EXCLUDE_HINTS,
      or: SEARCH_OR_HINT,
      isOptions: SEARCH_IS_OPTIONS,
      groups: SEARCH_SUGGESTION_GROUP_MESSAGE_KEYS,
    });
    const android = repoFile(
      "apps/android/core/model/src/main/kotlin/com/praveenjuge/teak/core/model/SharedConstants.kt"
    );
    for (const hint of hints) {
      expect(android).toContain(
        `SearchHint(id = "${hint.id}", group = "${hint.group}", key = "${hint.key}", insert = "${hint.insert}", messageKey = "${hint.messageKey}")`
      );
    }
    for (const option of SEARCH_IS_OPTIONS) {
      expect(android).toContain(
        `SearchIsOption(value = "${option.value}", words = listOf(${option.words.map((word) => `"${word}"`).join(", ")}), messageKey = "${option.messageKey}")`
      );
    }
  });
});
