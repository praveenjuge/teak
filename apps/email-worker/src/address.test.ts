import { describe, expect, test } from "bun:test";
import { isSaveAddress } from "./address";

describe("isSaveAddress", () => {
  test.each([
    ["save@in.teakvault.com", true],
    ["Save+Anything@In.TeakVault.com", true],
    ["SAVE@IN.TEAKVAULT.COM", true],
    ["save+@in.teakvault.com", true],
    ["<save@in.teakvault.com>", true],
    ["notes@in.teakvault.com", false],
    ["save.me@in.teakvault.com", false],
    ["save@teakvault.com", false],
    ["save@in-dev.teakvault.com", false],
    ["save@in.teakvault.com.evil.example", false],
    ["save@x@in.teakvault.com", false],
    ["", false],
  ])("%p is %p", (to, expected) => {
    expect(isSaveAddress(to, "in.teakvault.com")).toBe(expected);
  });

  test("the development domain is its own", () => {
    expect(
      isSaveAddress("save@in-dev.teakvault.com", "in-dev.teakvault.com")
    ).toBe(true);
  });
});
