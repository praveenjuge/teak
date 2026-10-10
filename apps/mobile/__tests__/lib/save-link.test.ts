import { describe, expect, test } from "bun:test";
import { textFromSaveLink } from "../../lib/save-link";

describe("save links", () => {
  test("keeps characters expo-router would cut off", () => {
    const text = "# Trip plan\n\n- Salt & pepper = 100% #food + more?";
    expect(
      textFromSaveLink(`teak://save?text=${encodeURIComponent(text)}`)
    ).toBe(text);
  });

  test("reads text alongside other params and treats + as a space", () => {
    expect(textFromSaveLink("teak://save?from=shortcut&text=hello+world")).toBe(
      "hello world"
    );
  });

  test("returns nothing when there's no text to save", () => {
    expect(textFromSaveLink(null)).toBe("");
    expect(textFromSaveLink("teak://save")).toBe("");
    expect(textFromSaveLink("teak://save?text=%20%20")).toBe("");
    expect(textFromSaveLink("teak://save?text=%E0%A4%A")).toBe("");
  });
});
