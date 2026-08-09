import { describe, expect, test } from "bun:test";
import {
  getRememberedMobileCardSummary,
  type MobileCardSummary,
  rememberMobileCardSummary,
} from "@/lib/mobile-card-summary-cache";

describe("mobile card summary cache", () => {
  test("makes the selected card available to its detail route", () => {
    const summary: MobileCardSummary = {
      _creationTime: 1,
      _id: "card-1" as MobileCardSummary["_id"],
      previewText: "Fast preview",
      title: "Selected card",
      type: "text",
    };

    rememberMobileCardSummary(summary);

    expect(getRememberedMobileCardSummary(summary._id)).toEqual(summary);
  });
});
