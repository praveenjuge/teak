// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../convex/billing";

describe("billing.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
