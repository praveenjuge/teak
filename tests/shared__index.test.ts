// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../convex/shared/index";

describe("shared/index.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
