// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from '../../convex/migrations';

describe("migrations.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
