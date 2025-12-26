// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../convex/workflows/functionRefs";

describe("workflows/functionRefs.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
