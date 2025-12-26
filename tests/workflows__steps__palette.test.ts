// @ts-nocheck
import { describe, expect, test, mock } from "bun:test";

const photonMock = () => ({
  PhotonImage: {
    new_from_byteslice: () => ({
      get_width: () => 0,
      get_height: () => 0,
      get_raw_pixels: () => new Uint8Array(),
      free: () => {},
    }),
  },
});
mock.module("@cf-wasm/photon", photonMock);
mock.module("@cf-wasm/photon/dist/workerd.js", photonMock);
mock.module(
  "/Users/praveenjuge/Projects/teak/node_modules/@cf-wasm/photon/dist/workerd.js",
  photonMock
);
const resolvedPhoton = import.meta.resolve
  ? import.meta.resolve("@cf-wasm/photon")
  : null;
if (resolvedPhoton) {
  mock.module(resolvedPhoton, photonMock);
}

describe("workflows/steps/palette.ts", () => {
  test("module exports", async () => {
    const module = await import("../convex/workflows/steps/palette");
    expect(module).toBeTruthy();
  });
});
