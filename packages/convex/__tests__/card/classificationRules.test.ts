import { describe, expect, test } from "bun:test";
import { textCardRulesType } from "../../card/classificationRules";

// The rules' answer Clef reviews for a note (scripts/clef-eval scores it).
describe("textCardRulesType", () => {
  test.each([
    ['"Simplicity is the ultimate sophistication."', "quote"],
    ["#264653 #2a9d8f #e9c46a", "palette"],
    ["Fix ticket #123 before Friday", "text"],
    ["dark green cabinets in the kitchen", "text"],
  ] as const)("%s is a %s", (content, expected) => {
    expect(textCardRulesType({ content })).toBe(expected);
  });
});
