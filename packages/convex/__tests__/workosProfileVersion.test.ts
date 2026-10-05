import { describe, expect, test } from "bun:test";
import {
  compareWorkosProfileVersions,
  normalizeWorkosProfileVersion,
} from "../workosProfileVersion";

// Failure modes: sub-millisecond updates collapse, offset-equivalent timestamps
// disagree, impossible calendar/clock values normalize silently, and future or
// oversized provider values advance trusted state.
describe("WorkOS provider profile versions", () => {
  test("orders updates without truncating fractional precision", () => {
    expect(
      compareWorkosProfileVersions(
        "2026-10-04T10:00:00.123456789123456789Z",
        "2026-10-04T10:00:00.123456789123456788Z"
      )
    ).toBe(1);
    expect(
      compareWorkosProfileVersions(
        "2026-10-04T10:00:00.001Z",
        "2026-10-04T10:00:00.01Z"
      )
    ).toBe(-1);
  });
  test("normalizes equivalent offsets and trailing fractional zeroes", () => {
    expect(
      normalizeWorkosProfileVersion("2026-10-04T15:30:00.120000+05:30")
    ).toBe("2026-10-04T10:00:00.12Z");
    expect(
      compareWorkosProfileVersions(
        "2026-10-04T15:30:00+05:30",
        "2026-10-04T10:00:00.000Z"
      )
    ).toBe(0);
  });
  test.each([
    "2026-02-30T10:00:00Z",
    "2026-10-04T25:00:00Z",
    "2026-10-04T10:60:00Z",
    "2026-10-04T10:00:60Z",
    "2026-10-04T10:00:00+24:00",
    "2026-10-04T10:00:00+01:60",
    "2026-10-04T10:00:00.1234567891234567891Z",
    "2026-10-04",
    "1960-10-04T10:00:00Z",
    "2999-10-04T10:00:00Z",
  ])("rejects unsafe provider timestamp %s", (value: string) => {
    expect(() => normalizeWorkosProfileVersion(value)).toThrow();
  });
});
