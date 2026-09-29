import { describe, expect, it } from "bun:test";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  CARD_TYPE_ICONS,
  CARD_TYPE_LABELS,
  CARD_TYPE_REGISTRY,
  CARD_TYPES,
  type CardErrorCode,
  type CardType,
  cardTypes,
  getCardTypeConfig,
  getCardTypeIcon,
  getCardTypeLabel,
  isCardType,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
  RESERVED_KEYWORDS,
} from "../../shared/constants";

describe("Constants", () => {
  describe("cardTypes", () => {
    it("lists exactly the supported card types", () => {
      expect([...cardTypes].sort()).toEqual([
        "audio",
        "document",
        "image",
        "link",
        "palette",
        "quote",
        "text",
        "video",
      ]);
      expect(CARD_TYPES).toEqual(cardTypes);
    });
  });

  describe("CARD_ERROR_MESSAGES", () => {
    it("has a non-empty message for every error code", () => {
      for (const code of Object.values(CARD_ERROR_CODES)) {
        expect(CARD_ERROR_MESSAGES[code as CardErrorCode]).toBeString();
        expect(
          CARD_ERROR_MESSAGES[code as CardErrorCode].length
        ).toBeGreaterThan(0);
      }
    });

    it("states the same upload limits the server enforces", () => {
      expect(CARD_ERROR_MESSAGES.FILE_TOO_LARGE).toContain(
        `${MAX_FILE_SIZE / (1024 * 1024)}MB`
      );
      expect(CARD_ERROR_MESSAGES.TOO_MANY_FILES).toContain(
        `${MAX_FILES_PER_UPLOAD} files`
      );
    });
  });

  describe("CARD_TYPE_LABELS", () => {
    it("should have label for each card type", () => {
      for (const type of cardTypes) {
        expect(CARD_TYPE_LABELS[type]).toBeDefined();
        expect(typeof CARD_TYPE_LABELS[type]).toBe("string");
      }
    });
  });

  describe("CARD_TYPE_ICONS", () => {
    it("should have icon for each card type", () => {
      for (const type of cardTypes) {
        expect(CARD_TYPE_ICONS[type]).toBeDefined();
        expect(typeof CARD_TYPE_ICONS[type]).toBe("string");
      }
    });
  });

  describe("CARD_TYPE_REGISTRY", () => {
    it("should have entry for each card type", () => {
      for (const type of cardTypes) {
        expect(CARD_TYPE_REGISTRY[type]).toBeDefined();
        expect(CARD_TYPE_REGISTRY[type].label).toBeDefined();
        expect(CARD_TYPE_REGISTRY[type].icon).toBeDefined();
        expect(CARD_TYPE_REGISTRY[type].searchLabel).toBeDefined();
      }
    });

    it("should have consistent labels with CARD_TYPE_LABELS", () => {
      for (const type of cardTypes) {
        expect(CARD_TYPE_REGISTRY[type].label).toBe(CARD_TYPE_LABELS[type]);
        expect(CARD_TYPE_REGISTRY[type].icon).toBe(CARD_TYPE_ICONS[type]);
      }
    });
  });

  describe("getCardTypeConfig", () => {
    it("should return config for valid card type", () => {
      const config = getCardTypeConfig("image");

      expect(config).toEqual({
        label: "Image",
        icon: "Image",
        searchLabel: "Images",
      });
    });

    it("should return different configs for different types", () => {
      const textConfig = getCardTypeConfig("text");
      const linkConfig = getCardTypeConfig("link");

      expect(textConfig.label).not.toBe(linkConfig.label);
    });
  });

  describe("getCardTypeIcon", () => {
    it("should return icon for valid card type", () => {
      expect(getCardTypeIcon("link")).toBe("Link");
      expect(getCardTypeIcon("video")).toBe("Video");
      expect(getCardTypeIcon("quote")).toBe("Quote");
    });
  });

  describe("getCardTypeLabel", () => {
    it("should return label for valid card type", () => {
      expect(getCardTypeLabel("text")).toBe("Text");
      expect(getCardTypeLabel("palette")).toBe("Palette");
      expect(getCardTypeLabel("audio")).toBe("Audio");
    });
  });

  describe("isCardType", () => {
    it("should return true for valid card types", () => {
      expect(isCardType("text")).toBe(true);
      expect(isCardType("link")).toBe(true);
      expect(isCardType("image")).toBe(true);
      expect(isCardType("video")).toBe(true);
      expect(isCardType("audio")).toBe(true);
      expect(isCardType("document")).toBe(true);
      expect(isCardType("palette")).toBe(true);
      expect(isCardType("quote")).toBe(true);
    });

    it("should return false for invalid card types", () => {
      expect(isCardType("invalid")).toBe(false);
      expect(isCardType("TEXT")).toBe(false);
      expect(isCardType("")).toBe(false);
      expect(isCardType("Link")).toBe(false);
    });

    it("should return false for non-string values", () => {
      expect(isCardType(null)).toBe(false);
      expect(isCardType(undefined)).toBe(false);
      expect(isCardType(123)).toBe(false);
      expect(isCardType({})).toBe(false);
      expect(isCardType([])).toBe(false);
    });

    it("narrows unknown values that are card types", () => {
      const value: unknown = "link";
      expect(isCardType(value)).toBe(true);
      expect(isCardType({ type: "link" })).toBe(false);
    });
  });

  describe("RESERVED_KEYWORDS", () => {
    it("should include all card types", () => {
      const cardTypeValues = RESERVED_KEYWORDS.filter((k) =>
        cardTypes.includes(k.value as CardType)
      );
      expect(cardTypeValues).toHaveLength(8);
    });

    it("should include favorites", () => {
      expect(RESERVED_KEYWORDS.some((k) => k.value === "favorites")).toBe(true);
      expect(
        RESERVED_KEYWORDS.find((k) => k.value === "favorites")?.label
      ).toBe("Favorites");
    });

    it("should include trash", () => {
      expect(RESERVED_KEYWORDS.some((k) => k.value === "trash")).toBe(true);
      expect(RESERVED_KEYWORDS.find((k) => k.value === "trash")?.label).toBe(
        "Trash"
      );
    });

    it("should have search labels for card types", () => {
      const imagesKeyword = RESERVED_KEYWORDS.find((k) => k.value === "image");
      expect(imagesKeyword?.label).toBe("Images");

      const linksKeyword = RESERVED_KEYWORDS.find((k) => k.value === "link");
      expect(linksKeyword?.label).toBe("Links");
    });
  });
});
