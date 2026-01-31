// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  findAttributeValue,
  getSelectorValue,
  toSelectorMap,
} from "../../../convex/linkMetadata/parsing";

describe("parsing selector helpers", () => {
  test("toSelectorMap builds map from results", () => {
    const map = toSelectorMap([
      { selector: "meta", results: [{ text: "A" }] },
      { selector: "title", results: [{ text: "B" }] },
    ]);
    expect(map.get("meta")?.[0]?.text).toBe("A");
    expect(map.get("title")?.[0]?.text).toBe("B");
  });

  test("findAttributeValue matches attribute name", () => {
    const value = findAttributeValue(
      { attributes: [{ name: "CONTENT", value: "  hello  " }] },
      "content"
    );
    expect(value).toBe("hello");
  });

  test("getSelectorValue returns first matching candidate", () => {
    const map = toSelectorMap([
      {
        selector: "meta[name='description']",
        results: [{ attributes: [{ name: "content", value: "  desc  " }] }],
      },
    ]);
    const value = getSelectorValue(map, {
      selector: "meta[name='description']",
      attribute: "content",
    });
    expect(value).toBe("desc");
  });
});
