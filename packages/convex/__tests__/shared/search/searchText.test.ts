import { describe, expect, test } from "bun:test";
import { buildCardSearchText } from "../../../shared/search/searchText";

describe("buildCardSearchText", () => {
  test("a [[…]] link is searchable by its title, not its id", () => {
    const text = buildCardSearchText({
      content:
        "Read [[Garden plan|teak:k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b]] first",
      notes: "Note",
      tags: ["home"],
    });
    expect(text).toBe("Read Garden plan first\nNote\nhome");
  });
});
