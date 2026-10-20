import { describe, expect, test } from "bun:test";
import { PRO_FEATURES } from "../../../constants/settings";

describe("settings constants", () => {
  test("describes browser extension access without excluding Safari", () => {
    expect(PRO_FEATURES).toContain("Browser Extensions");
    expect(PRO_FEATURES).not.toContain("Chrome Extension");
  });
});
