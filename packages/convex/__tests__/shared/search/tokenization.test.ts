import { describe, expect, test } from "bun:test";
import { classifySearchToken } from "../../../shared/search/tokenization";
import { loadFixture } from "../loadFixture";

const { classify } = loadFixture<{
  classify: { kind: string; token: string; value: string }[];
}>("searchTokens");

describe("classifySearchToken", () => {
  test.each(classify)("$token → $kind $value", ({ token, kind, value }) => {
    expect(classifySearchToken(token)).toEqual({ kind, value } as never);
  });

  test("punctuation alone is no word", () => {
    expect(classifySearchToken("...")).toBeNull();
  });
});
