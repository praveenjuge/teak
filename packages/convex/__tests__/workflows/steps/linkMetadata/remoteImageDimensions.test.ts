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

  test("rejects malicious ICNS data without throwing", () => {
    // GHSA-w3rx-r6r6-pgpr: image-size ICNS DoS. Probe must not throw or loop.
    const icns = new Uint8Array([
      0x69, 0x63, 0x6e, 0x73, 0x00, 0x00, 0x00, 0x10, 0x69, 0x63, 0x30, 0x39,
      0x00, 0x00, 0x00, 0x08, 0xff, 0xff, 0xff, 0xff,
    ]);
    expect(readRemoteImageDimensions(icns)).toBeNull();
    // Truncated ICNS header
    expect(
      readRemoteImageDimensions(new Uint8Array([0x69, 0x63, 0x6e, 0x73]))
    ).toBeNull();
  });

  test("rejects zero-sized HEIF/AVIF boxes without throwing", () => {
    // GHSA-5p2g-fcmc-qvqq: HEIF/AVIF with zero-sized boxes must not hang or OOM.
    const heifZeroBox = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31,
      0x00, 0x00, 0x00, 0x00, 0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63,
      0x00, 0x00, 0x00, 0x00, 0x6d, 0x65, 0x74, 0x61,
    ]);
    expect(readRemoteImageDimensions(heifZeroBox)).toBeNull();
    const avifZeroBox = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
      0x00, 0x00, 0x00, 0x00, 0x61, 0x76, 0x69, 0x66, 0x6d, 0x69, 0x66, 0x31,
      0x00, 0x00, 0x00, 0x00, 0x6d, 0x65, 0x74, 0x61,
    ]);
    expect(readRemoteImageDimensions(avifZeroBox)).toBeNull();
  });

  test("rejects malformed SVG without DoS", () => {
    // Version 7.4.0 fixes SVG DoS: header search limited to first 10K.
    const malformedSvg = new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" width="x" height="y"><g>${"a".repeat(20_000)}</g></svg>`
    );
    expect(readRemoteImageDimensions(malformedSvg)).toBeNull();
    const noDimSvg = new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg"></svg>`
    );
    expect(readRemoteImageDimensions(noDimSvg)).toBeNull();
    // Entity expansion should not hang and should still parse valid dimensions.
    const entitySvg = new TextEncoder().encode(
      `<!DOCTYPE svg [<!ENTITY x "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">&x;</svg>`
    );
    const result = readRemoteImageDimensions(entitySvg);
    // Should not throw and should return dimensions if parsed, or null if rejected — but must not hang.
    expect(
      result === null || (result.width === 10 && result.height === 10)
    ).toBe(true);
  });

  test("rejects completely malformed input without throwing", () => {
    expect(readRemoteImageDimensions(new Uint8Array([]))).toBeNull();
    expect(
      readRemoteImageDimensions(
        new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0x33])
      )
    ).toBeNull();
    expect(
      readRemoteImageDimensions(new TextEncoder().encode("not an image"))
    ).toBeNull();
  });

  test("rejects excessive dimensions beyond 32-megapixel budget", () => {
    expect(readRemoteImageDimensions(pngWithDimensions(8000, 5000))).toBeNull();
    expect(
      readRemoteImageDimensions(pngWithDimensions(10_000, 4000))
    ).toBeNull();
    const atBudget = Math.floor(Math.sqrt(MAX_REMOTE_IMAGE_PIXELS));
    expect(
      readRemoteImageDimensions(pngWithDimensions(atBudget, atBudget))
    ).not.toBeNull();
  });
});
