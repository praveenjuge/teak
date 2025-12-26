// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../convex/shared/types";

describe("shared/types.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
