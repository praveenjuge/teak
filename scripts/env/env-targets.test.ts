import { describe, expect, test } from "bun:test";
import { isSupportedCombo } from "./env-targets.ts";

describe("env-targets", () => {
  test("supported combos gate target/profile pairs", () => {
    expect(isSupportedCombo("web", "local")).toBe(true);
    expect(isSupportedCombo("extension", "local")).toBe(true);
    expect(isSupportedCombo("web", "e2e")).toBe(false);
    expect(isSupportedCombo("e2e", "e2e")).toBe(false);
    expect(isSupportedCombo("unknown", "local")).toBe(false);
  });
});
