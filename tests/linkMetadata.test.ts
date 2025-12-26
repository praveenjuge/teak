// @ts-nocheck
import { describe, expect, test } from "bun:test";
import * as module from "../convex/linkMetadata";

describe("linkMetadata.ts", () => {
  test("module exports", () => {
    expect(module).toBeTruthy();
  });
});
