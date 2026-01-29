import { describe, it, expect } from "bun:test";
import {
  cardTypes,
  FREE_TIER_LIMIT,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  CARD_TYPES,
  CARD_TYPE_LABELS,
  CARD_TYPE_ICONS,
  CARD_TYPE_REGISTRY,
  getCardTypeConfig,
  getCardTypeIcon,
  getCardTypeLabel,
  isCardType,
  RESERVED_KEYWORDS,
  type CardType,
  type CardErrorCode,
} from "./constants";

describe("Constants", () => {
  describe("cardTypes", () => {
    it("should contain all expected card types", () => {
      expect(cardTypes).toContain("text");
      expect(cardTypes).toContain("link");
      expect(cardTypes).toContain("image");
      expect(cardTypes).toContain("video");
      expect(cardTypes).toContain("audio");
      expect(cardTypes).toContain("document");
      expect(cardTypes).toContain("palette");
      expect(cardTypes).toContain("quote");
    });

    it("should be a readonly array of 8 types", () => {
      expect(cardTypes).toHaveLength(8);
    });
  });

  describe("FREE_TIER_LIMIT", () => {
    it("should be 200", () => {
      expect(FREE_TIER_LIMIT).toBe(200);
    });
  });

  describe("MAX_FILE_SIZE", () => {
    it("should be 20MB in bytes", () => {
      expect(MAX_FILE_SIZE).toBe(20 * 1024 * 1024);
      expect(MAX_FILE_SIZE).toBe(20971520);
    });
  });

  describe("MAX_FILES_PER_UPLOAD", () => {
    it("should be 5", () => {
      expect(MAX_FILES_PER_UPLOAD).toBe(5);
    });
  });

  describe("CARD_ERROR_CODES", () => {
    it("should have all expected error codes", () => {
      expect(CARD_ERROR_CODES.CARD_LIMIT_REACHED).toBe("CARD_LIMIT_REACHED");
      expect(CARD_ERROR_CODES.RATE_LIMITED).toBe("RATE_LIMITED");
      expect(CARD_ERROR_CODES.FILE_TOO_LARGE).toBe("FILE_TOO_LARGE");
      expect(CARD_ERROR_CODES.TOO_MANY_FILES).toBe("TOO_MANY_FILES");
      expect(CARD_ERROR_CODES.UNSUPPORTED_TYPE).toBe("UNSUPPORTED_TYPE");
      expect(CARD_ERROR_CODES.TYPE_MISMATCH).toBe("TYPE_MISMATCH");
    });
  });

  describe("CARD_ERROR_MESSAGES", () => {
    it("should have message for each error code", () => {
      const codes: CardErrorCode[] = [
        "CARD_LIMIT_REACHED",
        "RATE_LIMITED",
        "FILE_TOO_LARGE",
        "TOO_MANY_FILES",
        "UNSUPPORTED_TYPE",
        "TYPE_MISMATCH",
      ];

      for (const code of codes) {
        expect(CARD_ERROR_MESSAGES[code]).toBeDefined();
        expect(typeof CARD_ERROR_MESSAGES[code]).toBe("string");
        expect(CARD_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
      }
    });

    it("should have specific messages", () => {
      expect(CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED).toContain("upgrade to Pro");
      expect(CARD_ERROR_MESSAGES.FILE_TOO_LARGE).toContain("20MB");
      expect(CARD_ERROR_MESSAGES.TOO_MANY_FILES).toContain("5 files");
    });
  });

  describe("CARD_TYPES", () => {
    it("should be an array", () => {
      expect(Array.isArray(CARD_TYPES)).toBe(true);
    });

    it("should have all card types", () => {
      expect(CARD_TYPES).toHaveLength(8);
    });
  });

  describe("CARD_TYPE_LABELS", () => {
    it("should have label for each card type", () => {
      for (const type of cardTypes) {
        expect(CARD_TYPE_LABELS[type]).toBeDefined();
        expect(typeof CARD_TYPE_LABELS[type]).toBe("string");
      }
    });

    it("should have human-readable labels", () => {
      expect(CARD_TYPE_LABELS.text).toBe("Text");
      expect(CARD_TYPE_LABELS.link).toBe("Link");
      expect(CARD_TYPE_LABELS.image).toBe("Image");
      expect(CARD_TYPE_LABELS.video).toBe("Video");
      expect(CARD_TYPE_LABELS.audio).toBe("Audio");
      expect(CARD_TYPE_LABELS.document).toBe("Document");
      expect(CARD_TYPE_LABELS.palette).toBe("Palette");
      expect(CARD_TYPE_LABELS.quote).toBe("Quote");
    });
  });

  describe("CARD_TYPE_ICONS", () => {
    it("should have icon for each card type", () => {
      for (const type of cardTypes) {
        expect(CARD_TYPE_ICONS[type]).toBeDefined();
        expect(typeof CARD_TYPE_ICONS[type]).toBe("string");
      }
    });

    it("should have expected icon names", () => {
      expect(CARD_TYPE_ICONS.text).toBe("FileText");
      expect(CARD_TYPE_ICONS.link).toBe("Link");
      expect(CARD_TYPE_ICONS.image).toBe("Image");
      expect(CARD_TYPE_ICONS.video).toBe("Video");
      expect(CARD_TYPE_ICONS.audio).toBe("Volume2");
      expect(CARD_TYPE_ICONS.document).toBe("File");
      expect(CARD_TYPE_ICONS.palette).toBe("Palette");
      expect(CARD_TYPE_ICONS.quote).toBe("Quote");
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

    it("should work as type guard", () => {
      const value = "link" as unknown;
      if (isCardType(value)) {
        // TypeScript should know value is CardType here
        // The satisfies operator returns the value itself if it satisfies the type
        expect(value).toBe("link");
        // And cardTypes includes "link"
        expect(cardTypes.includes(value as CardType)).toBe(true);
      }
    });
  });

  describe("RESERVED_KEYWORDS", () => {
    it("should include all card types", () => {
      const cardTypeValues = RESERVED_KEYWORDS.filter((k) => cardTypes.includes(k.value as CardType));
      expect(cardTypeValues).toHaveLength(8);
    });

    it("should include favorites", () => {
      expect(RESERVED_KEYWORDS.some((k) => k.value === "favorites")).toBe(true);
      expect(RESERVED_KEYWORDS.find((k) => k.value === "favorites")?.label).toBe("Favorites");
    });

    it("should include trash", () => {
      expect(RESERVED_KEYWORDS.some((k) => k.value === "trash")).toBe(true);
      expect(RESERVED_KEYWORDS.find((k) => k.value === "trash")?.label).toBe("Trash");
    });

    it("should have search labels for card types", () => {
      const imagesKeyword = RESERVED_KEYWORDS.find((k) => k.value === "image");
      expect(imagesKeyword?.label).toBe("Images");

      const linksKeyword = RESERVED_KEYWORDS.find((k) => k.value === "link");
      expect(linksKeyword?.label).toBe("Links");
    });
  });
});
