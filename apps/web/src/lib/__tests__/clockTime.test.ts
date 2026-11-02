import { describe, expect, test } from "bun:test";
import { formatDuration } from "@/components/cards/cardDisplay";
import { formatClockTime } from "../clockTime";

describe("clock time", () => {
  test.each([
    [0, "0:00"],
    [5, "0:05"],
    [84.7, "1:24"],
    [605, "10:05"],
    [4500, "1:15:00"],
    [3725, "1:02:05"],
  ])("reads %s seconds as %s", (seconds, label) => {
    expect(formatClockTime(seconds)).toBe(label);
  });

  test("reads an unknown length as 0:00", () => {
    expect(formatClockTime(Number.NaN)).toBe("0:00");
    expect(formatClockTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatClockTime(-3)).toBe("0:00");
  });

  test("a recording's card and its player give the same length", () => {
    for (const seconds of [84.7, 4500, 4500.6]) {
      expect(formatDuration(seconds)).toBe(formatClockTime(seconds));
    }
  });
});
