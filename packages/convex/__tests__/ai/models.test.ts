// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../../../convex/ai/models";

describe("ai/models.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
