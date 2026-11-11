import { describe, expect, test } from "bun:test";
import { FILES_UPLOAD_MAX_BYTES } from "@teak/files-protocol";
import { RENDERER_MAX_INPUT_BYTES } from "../../container/src/protocol";
import { JPEG_BYTES, rendererResponse } from "../test/testsupport";
import { RendererUnavailable } from "./containerPool";
import { readRendererOutputs } from "./rendererClient";

const frameSpec = {
  frame: { kind: "jpeg" as const, maxBytes: 100, required: true },
  scrub: { kind: "jpeg" as const, maxBytes: 100, required: false },
};

const withManifest = (manifest: unknown, body: Uint8Array) =>
  new Response(body, {
    headers: { "x-teak-manifest": JSON.stringify(manifest) },
  });

test("the renderer takes every file the Worker may send it", () => {
  expect(RENDERER_MAX_INPUT_BYTES).toBe(FILES_UPLOAD_MAX_BYTES);
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
