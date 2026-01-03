// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from '../../convex/http';

describe("http.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
