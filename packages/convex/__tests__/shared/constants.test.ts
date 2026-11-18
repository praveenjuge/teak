import { describe, expect, it } from "bun:test";
import {
  CARD_ERROR_MESSAGES,
  isCardType,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
} from "../../shared/constants";

describe("Constants", () => {
  describe("CARD_ERROR_MESSAGES", () => {
    it("states the same upload limits the server enforces", () => {
      expect(CARD_ERROR_MESSAGES.FILE_TOO_LARGE).toContain(
        `${MAX_FILE_SIZE / (1024 * 1024)}MB`
      );
      expect(CARD_ERROR_MESSAGES.TOO_MANY_FILES).toContain(
        `${MAX_FILES_PER_UPLOAD} files`
      );
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
  });
});
