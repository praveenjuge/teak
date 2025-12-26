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
const resolvedPhoton = import.meta.resolve
  ? import.meta.resolve("@cf-wasm/photon")
  : null;
if (resolvedPhoton) {
  mock.module(resolvedPhoton, photonMock);
}
mock.module("@onkernel/sdk", () => ({
  default: class KernelMock {},
}));

describe("workflows/steps/renderables.ts", () => {
  test("module exports", async () => {
    const module = await import("../convex/workflows/steps/renderables");
    expect(module).toBeTruthy();
  });
});
