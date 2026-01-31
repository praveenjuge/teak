// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from '../schema';

describe("schema.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
