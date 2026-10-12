import { describe, expect, test } from "bun:test";
import {
  RendererUnavailable,
  readRendererOutputs,
  rendererInstanceOrder,
  rendererPoolSize,
} from "./rendererClient";
import { JPEG_BYTES, rendererResponse } from "./testsupport";

const frameSpec = {
  frame: { kind: "jpeg" as const, maxBytes: 100, required: true },
  scrub: { kind: "jpeg" as const, maxBytes: 100, required: false },
};

const withManifest = (manifest: unknown, body: Uint8Array) =>
  new Response(body, {
    headers: { "x-teak-manifest": JSON.stringify(manifest) },
  });

describe("renderer pool", () => {
  test("tries every instance once, starting at a random one", () => {
    expect(rendererInstanceOrder(4, () => 0.6)).toEqual([
      "renderer-2",
      "renderer-3",
      "renderer-0",
      "renderer-1",
    ]);
  });

  test.each([
    [undefined, 2],
    ["4", 4],
    ["0", 2],
    ["many", 2],
    ["99", 16],
  ])("reads pool size %p as %i", (value, size) => {
    expect(rendererPoolSize({ MEDIA_RENDERER_INSTANCES: value })).toBe(size);
  });
});

describe("renderer outputs", () => {
  test("splits the body into the parts the manifest lists", async () => {
    const result = await readRendererOutputs(
      rendererResponse({ facts: { format: "mp4" } }, [
        { bytes: JPEG_BYTES, name: "frame", type: "image/jpeg" },
        { bytes: JPEG_BYTES, name: "scrub", type: "image/jpeg" },
      ]),
      frameSpec
    );
    expect(result.manifest.facts).toEqual({ format: "mp4" });
    expect(result.parts.get("frame")).toEqual(JPEG_BYTES);
    expect(result.parts.get("scrub")).toEqual(JPEG_BYTES);
  });

  const part = (name: string, length: number) => ({
    length,
    name,
    type: "image/jpeg",
  });

  test.each([
    ["no manifest", null, JPEG_BYTES],
    ["another protocol", { facts: null, parts: [], protocol: 2 }, JPEG_BYTES],
    [
      "a body shorter than the manifest",
      { facts: null, parts: [part("frame", 10)], protocol: 1 },
      JPEG_BYTES,
    ],
    [
      "a body longer than the manifest",
      { facts: null, parts: [part("frame", 3)], protocol: 1 },
      JPEG_BYTES,
    ],
    [
      "an unexpected part",
      { facts: null, parts: [part("other", 7)], protocol: 1 },
      JPEG_BYTES,
    ],
    [
      "a part over its size cap",
      { facts: null, parts: [part("frame", 101)], protocol: 1 },
      new Uint8Array(101).fill(0xff),
    ],
    [
      "a missing required part",
      { facts: null, parts: [part("scrub", 7)], protocol: 1 },
      JPEG_BYTES,
    ],
    [
      "bytes that are not a JPEG",
      { facts: null, parts: [part("frame", 3)], protocol: 1 },
      new Uint8Array([1, 2, 3]),
    ],
  ])("refuses %s", async (_name, manifest, body) => {
    const response =
      manifest === null ? new Response(body) : withManifest(manifest, body);
    await expect(
      readRendererOutputs(response, frameSpec)
    ).rejects.toBeInstanceOf(RendererUnavailable);
  });
});
