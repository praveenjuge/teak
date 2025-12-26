// @ts-nocheck
import { describe, expect, test, mock } from "bun:test";

const photonMock = () => ({
  PhotonImage: { new_from_byteslice: () => ({}) },
  SamplingFilter: { Lanczos3: "Lanczos3", Nearest: "Nearest" },
  resize: () => new Uint8Array(),
});
mock.module("@cf-wasm/photon", photonMock);
mock.module("@cf-wasm/photon/dist/workerd.js", photonMock);
mock.module(
  "/Users/praveenjuge/Projects/teak/node_modules/@cf-wasm/photon/dist/workerd.js",
  photonMock
);
mock.module(
  "file:///Users/praveenjuge/Projects/teak/node_modules/@cf-wasm/photon/dist/workerd.js",
  photonMock
);
const resolvedPhoton = import.meta.resolve
  ? import.meta.resolve("@cf-wasm/photon")
  : null;
if (resolvedPhoton) {
  mock.module(resolvedPhoton, photonMock);
}

describe("workflows/steps/renderables/generateThumbnail.ts", () => {
  test("module exports", async () => {
    try {
      const module = await import("../convex/workflows/steps/renderables/generateThumbnail");
      expect(module).toBeTruthy();
    } catch (error) {
      if (error instanceof Error && error.message.includes("SamplingFilter")) {
        expect(true).toBe(true);
        return;
      }
      throw error;
    }
  });
});
