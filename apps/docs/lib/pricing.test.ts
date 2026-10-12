import { describe, expect, test } from "bun:test";
import { formatUsd, yearlyPerMonth, yearlySavingsPercent } from "./pricing";

describe("yearly pricing", () => {
  test("yearly Pro saves 57% over paying monthly", () => {
    // The page once claimed 35%; $99 against 12 × $19 = $228 is 56.6% off.
    expect(yearlySavingsPercent()).toBe(57);
    expect(yearlySavingsPercent(10, 60)).toBe(50);
  });

  test("spreads the yearly price over twelve months", () => {
    expect(formatUsd(yearlyPerMonth())).toBe("$8.25");
  });

  test("formats whole and fractional dollars", () => {
    expect(formatUsd(19)).toBe("$19");
    expect(formatUsd(8.5)).toBe("$8.50");
  });
});
