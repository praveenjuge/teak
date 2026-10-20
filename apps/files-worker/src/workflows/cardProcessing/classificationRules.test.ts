import { describe, expect, test } from "bun:test";
import {
  MAX_COLOR_FN_ARG_CHARS,
  textCardRulesType,
} from "./classificationRules";

describe("textCardRulesType", () => {
  test.each([
    ['"Simplicity is the ultimate sophistication."', "quote"],
    ["#264653 #2a9d8f #e9c46a", "palette"],
    ["Fix ticket #123 before Friday", "text"],
    ["dark green cabinets in the kitchen", "text"],
  ] as const)("%s is a %s", (content, expected) => {
    expect(textCardRulesType({ content })).toBe(expected);
  });

  const functionalColors = (padding: number) => {
    const pad = " ".repeat(padding);
    return `rgb(${pad}1, 2, 3); hsl(${pad}10, 50%, 50%)`;
  };

  test("reads rgb() and hsl() colors whose arguments fit the bound", () => {
    expect(
      textCardRulesType({
        content: functionalColors(MAX_COLOR_FN_ARG_CHARS - 20),
      })
    ).toBe("palette");
  });

  test("stops reading rgb() and hsl() arguments past the bound", () => {
    expect(
      textCardRulesType({ content: functionalColors(MAX_COLOR_FN_ARG_CHARS) })
    ).toBe("text");
  });

  test("an unclosed rgb( followed by a long note stays text", () => {
    expect(textCardRulesType({ content: `rgb(${"1, ".repeat(100_000)}` })).toBe(
      "text"
    );
  });
});
