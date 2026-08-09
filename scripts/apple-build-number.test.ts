import { describe, expect, test } from "bun:test";
import { nextAppleBuildNumber } from "./apple-build-number.mjs";

const builds = (...versions: string[]) => ({
  data: versions.map((version) => ({ attributes: { version } })),
});

describe("Apple build-number allocation", () => {
  test("starts at one when the app has no builds", () => {
    expect(nextAppleBuildNumber(builds())).toBe("1");
  });

  test("increments the maximum positive integer deterministically", () => {
    expect(nextAppleBuildNumber(builds("63", "9", "64", "12"))).toBe("65");
  });

  test("fails closed for missing or non-integer history", () => {
    expect(() => nextAppleBuildNumber({})).toThrow(
      "Expected an App Store Connect builds response"
    );
    expect(() => nextAppleBuildNumber(builds("63", "1.2.3"))).toThrow(
      "Unsafe App Store build number: 1.2.3"
    );
  });
});
