// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../convex/shared/rateLimits";

describe("shared/rateLimits.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
