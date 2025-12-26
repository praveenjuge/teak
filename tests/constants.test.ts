// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  CARD_TYPES,
  CARD_TYPE_LABELS,
  CARD_TYPE_ICONS,
  getCardTypeConfig,
  getCardTypeIcon,
  getCardTypeLabel,
  isCardType,
  RESERVED_KEYWORDS,
} from "../convex/shared/constants";

describe("shared constants", () => {
  test("CARD_TYPES aligns with labels/icons", () => {
    for (const type of CARD_TYPES) {
      expect(CARD_TYPE_LABELS[type]).toBeTruthy();
      expect(CARD_TYPE_ICONS[type]).toBeTruthy();
    }
  });

  test("getCardType helpers return registry data", () => {
    const config = getCardTypeConfig("text");
    expect(config.label).toBe(getCardTypeLabel("text"));
    expect(config.icon).toBe(getCardTypeIcon("text"));
  });

  test("isCardType guards valid values", () => {
    expect(isCardType("link")).toBe(true);
    expect(isCardType("nope")).toBe(false);
  });

  test("reserved keywords include favorites/trash", () => {
    const values = RESERVED_KEYWORDS.map((entry) => entry.value);
    expect(values).toContain("favorites");
    expect(values).toContain("trash");
  });
});
