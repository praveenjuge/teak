import { describe, expect, test } from "bun:test";
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

const english = flattenCatalog(
  await Bun.file(
    new URL("../../../../i18n/messages/en.json", import.meta.url)
  ).json()
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
});
