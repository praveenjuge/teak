// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from '../../convex/crons';

describe("crons.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
