import { describe, expect, test } from "bun:test";
import { waitingSaveIds } from "../../lib/pendingSaves";

describe("waitingSaveIds", () => {
  test("does not count a save that is still running as pending", () => {
    expect(waitingSaveIds(["in-flight"], new Set(["in-flight"]))).toEqual([]);
  });

  test("keeps saves that stopped without finishing", () => {
    expect(
      waitingSaveIds(["failed", "in-flight", "offline"], new Set(["in-flight"]))
    ).toEqual(["failed", "offline"]);
  });
});
