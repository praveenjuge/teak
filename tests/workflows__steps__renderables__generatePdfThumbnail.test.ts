// @ts-nocheck
import { describe, expect, test, mock } from "bun:test";

mock.module("@onkernel/sdk", () => ({
  default: class KernelMock {},
}));

describe("workflows/steps/renderables/generatePdfThumbnail.ts", () => {
  test("module exports", async () => {
    const module = await import("../convex/workflows/steps/renderables/generatePdfThumbnail");
    expect(module).toBeTruthy();
  });
});
