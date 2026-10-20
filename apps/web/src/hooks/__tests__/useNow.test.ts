import { describe, expect, test } from "bun:test";
import { nextDeadline } from "../useNow";

describe("nextDeadline", () => {
  test("picks the earliest deadline still ahead", () => {
    expect(nextDeadline([3000, 2000, null, undefined], 1000)).toBe(2000);
  });

  test("skips deadlines already passed", () => {
    expect(nextDeadline([500, 1000, 4000], 1000)).toBe(4000);
  });

  test("is null with nothing ahead", () => {
    expect(nextDeadline([500, null], 1000)).toBeNull();
    expect(nextDeadline([], 1000)).toBeNull();
  });
});
