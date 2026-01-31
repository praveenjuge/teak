
import { describe, expect, test } from "bun:test";
import {
  getCardTypeConfig,
  getCardTypeIcon,
  getCardTypeLabel,
  isCardType,
  CARD_TYPE_REGISTRY,
} from '../../../convex/shared/constants';

describe("constants", () => {
  describe("helper functions", () => {
    test("getCardTypeConfig returns config for valid type", () => {
      expect(getCardTypeConfig("text")).toEqual(CARD_TYPE_REGISTRY.text);
    });

    test("getCardTypeIcon returns icon", () => {
      expect(getCardTypeIcon("image")).toBe("Image");
    });

    test("getCardTypeLabel returns label", () => {
      expect(getCardTypeLabel("link")).toBe("Link");
    });

    test("isCardType validates known types", () => {
      expect(isCardType("text")).toBe(true);
      expect(isCardType("link")).toBe(true);
    });

    test("isCardType rejects unknown types", () => {
      expect(isCardType("unknown")).toBe(false);
      expect(isCardType(123)).toBe(false);
      expect(isCardType(null)).toBe(false);
    });
  });
});
