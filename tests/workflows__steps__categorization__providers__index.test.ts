// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../convex/workflows/steps/categorization/providers/index";

describe("workflows/steps/categorization/providers/index.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
