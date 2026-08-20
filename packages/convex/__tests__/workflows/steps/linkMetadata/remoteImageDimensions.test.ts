import { describe, expect, test } from "bun:test";
import {
  MAX_REMOTE_IMAGE_PIXELS,
  readRemoteImageDimensions,
} from "../../../../workflows/steps/linkMetadata/remoteImageDimensions";

const pngWithDimensions = (width: number, height: number) => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

describe("readRemoteImageDimensions", () => {
  test("reads dimensions without decoding image pixels", () => {
    expect(readRemoteImageDimensions(pngWithDimensions(1200, 630))).toEqual({
      height: 630,
      width: 1200,
    });
  });

  test("rejects images whose decoded pixel count exceeds the budget", () => {
    expect(
      readRemoteImageDimensions(pngWithDimensions(MAX_REMOTE_IMAGE_PIXELS, 2))
    ).toBeNull();
  });

  test("rejects malformed or zero-sized images", () => {
    expect(readRemoteImageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readRemoteImageDimensions(pngWithDimensions(0, 10))).toBeNull();
  });
});
