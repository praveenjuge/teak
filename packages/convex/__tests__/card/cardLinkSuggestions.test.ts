import { describe, expect, test } from "bun:test";
import { rankCardLinkSuggestions } from "../../card/cardLinks";

const titles = (items: { title: string }[]) => items.map((item) => item.title);

describe("rankCardLinkSuggestions", () => {
  test("puts the exact title first, then titles that start with the query", () => {
    const items = [
      { title: "verify-capx-12.txt" },
      { title: "Notes about verify-capx-1" },
      { title: "verify-capx-1 draft" },
      { title: "Verify-capx-1" },
    ];
    expect(titles(rankCardLinkSuggestions(items, "verify-capx-1"))).toEqual([
      "Verify-capx-1",
      "verify-capx-1 draft",
      "verify-capx-12.txt",
      "Notes about verify-capx-1",
    ]);
  });

  test("keeps the search order within a rank, and for an empty query", () => {
    const items = [{ title: "B plan" }, { title: "A plan" }, { title: "Plan" }];
    expect(titles(rankCardLinkSuggestions(items, "  "))).toEqual([
      "B plan",
      "A plan",
      "Plan",
    ]);
    expect(titles(rankCardLinkSuggestions(items, "zzz"))).toEqual([
      "B plan",
      "A plan",
      "Plan",
    ]);
  });
});
