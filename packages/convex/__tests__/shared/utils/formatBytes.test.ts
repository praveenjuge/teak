import { describe, expect, test } from "bun:test";
import { formatBytes } from "../../../shared/utils/formatBytes";

describe("formatBytes", () => {
  test.each([
    [0, "0 B"],
    [-5, "0 B"],
    [undefined, "0 B"],
    [null, "0 B"],
    [Number.NaN, "0 B"],
    [Number.POSITIVE_INFINITY, "0 B"],
  ])("reads %p as an empty size", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  test.each([
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [4_812_000, "4.6 MB"],
    [5 * 1024 ** 2, "5.0 MB"],
    [52_428_800, "50 MB"],
    [3 * 1024 ** 3, "3.0 GB"],
  ])("formats %i bytes as %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  test("keeps sizes past a terabyte in gigabytes", () => {
    expect(formatBytes(2 * 1024 ** 4)).toBe("2048 GB");
  });
});
