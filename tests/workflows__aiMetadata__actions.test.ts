// @ts-nocheck
import { describe, expect, test, beforeEach } from "bun:test";

describe("workflows/aiMetadata/actions.ts", () => {
  let extractPaletteWithAi: any;

  beforeEach(async () => {
    const module = await import("../convex/workflows/aiMetadata/actions");
    extractPaletteWithAi = module.extractPaletteWithAi;
  });

  test("extractPaletteWithAi is exported", () => {
    expect(typeof extractPaletteWithAi).toBe("function");
  });

  test("extractPaletteWithAi returns empty array (deprecated)", async () => {
    const result = await extractPaletteWithAi();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  test("extractPaletteWithAi ignores arguments", async () => {
    const result = await extractPaletteWithAi("some argument", { another: "arg" });
    expect(result).toEqual([]);
  });
});
