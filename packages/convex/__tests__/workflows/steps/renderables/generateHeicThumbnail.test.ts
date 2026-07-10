import { describe, expect, test } from "bun:test";
import { copyToExactArrayBuffer } from "../../../../workflows/steps/renderables/generateHeicThumbnail";

describe("HEIC thumbnail bytes", () => {
  test("copies only the visible bytes from pooled or offset views", () => {
    const pooled = new Uint8Array([99, 1, 2, 3, 88]);
    const exact = copyToExactArrayBuffer(pooled.subarray(1, 4));

    expect(exact.byteLength).toBe(3);
    expect(Array.from(new Uint8Array(exact))).toEqual([1, 2, 3]);
  });
});
