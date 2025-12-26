// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  LINK_CATEGORIES,
  LINK_CATEGORY_LABELS,
  LINK_CATEGORY_ICONS,
  normalizeLinkCategory,
} from "../convex/shared/linkCategories";

describe("linkCategories", () => {
  test("labels and icons exist for each category", () => {
    for (const category of LINK_CATEGORIES) {
      expect(LINK_CATEGORY_LABELS[category]).toBeTruthy();
      expect(LINK_CATEGORY_ICONS[category]).toBeTruthy();
    }
  });

  test("normalizeLinkCategory handles label variants", () => {
    expect(normalizeLinkCategory("Book / eBook")).toBe("book");
    expect(normalizeLinkCategory("Design Portfolio")).toBe("design_portfolio");
  });

  test("normalizeLinkCategory returns null for empty", () => {
    expect(normalizeLinkCategory(" ")).toBe(null);
  });
});
