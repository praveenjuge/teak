// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../convex/workflows/manager";

describe("workflows/manager.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
