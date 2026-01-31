// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from '../cards';

describe("cards.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
