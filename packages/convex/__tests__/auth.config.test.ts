// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../auth.config";

describe("auth.config.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
