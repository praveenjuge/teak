// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../convex/index";

describe("index.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
