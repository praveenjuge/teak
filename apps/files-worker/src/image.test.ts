import { describe, expect, test } from "bun:test";
import {
  detectImageFormat,
  ImageSourceMissing,
  ImageTooLarge,
  processImage,
} from "./image";
import { FakeBucket, makePng, readFixture } from "./testsupport";

describe("process-image op", () => {
  test("skips thumbnails for small images but still returns dimensions and palette", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(100, 80) });

    const result = await processImage(bucket, "src.png", "dest/t.webp");
    expect(result).toEqual({
      exif: null,
      height: 80,
      palette: ["#FF0000"],
      previewGenerated: false,
      previewKey: null,
      thumbhash: expect.any(String),
      thumbnailGenerated: false,
      thumbnailKey: null,
      width: 100,
    });
    expect(bucket.puts).toHaveLength(0);
  });

  test("resizes large images to bounded lossy webp thumbnails and writes them back", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(600, 400) });

    const result = await processImage(bucket, "src.png", "dest/t.webp");
    expect(result.thumbnailGenerated).toBe(true);
    expect(result.thumbnailKey).toBe("dest/t.webp");
    expect(result.width).toBe(600);
    expect(result.height).toBe(400);
    expect(result.palette.length).toBeGreaterThan(0);
    expect(typeof result.thumbhash).toBe("string");

    expect(bucket.puts).toHaveLength(1);
    const put = bucket.puts[0];
    expect((put as any).key).toBe("dest/t.webp");
    expect((put as any).httpMetadata?.contentType).toBe("image/webp");
    // WebP container magic.
    expect((put as any).bytes.subarray(0, 4)).toEqual(
      new Uint8Array([82, 73, 70, 70])
    );
    expect(new TextDecoder().decode((put as any).bytes.slice(8, 12))).toBe(
      "WEBP"
    );
    // VP8 (lossy) chunk — photon's lossless encoder emits a VP8L chunk.
    expect(new TextDecoder().decode((put as any).bytes.slice(12, 16))).toBe(
      "VP8 "
    );
  });

  test("writes a bounded preview derivative for oversized originals", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(2000, 1200) });

    const result = await processImage(bucket, "src.png", "dest/t.webp", {
      previewDestKey: "dest/preview.webp",
    });
    expect(result.previewGenerated).toBe(true);
    expect(result.previewKey).toBe("dest/preview.webp");

    expect(bucket.puts.map((p) => (p as any).key).sort()).toEqual([
      "dest/preview.webp",
      "dest/t.webp",
    ]);
    for (const put of bucket.puts) {
      expect(new TextDecoder().decode((put as any).bytes.slice(12, 16))).toBe(
        "VP8 "
      );
    }
  });

  test("skips the preview when the original already fits", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(600, 400) });

    const result = await processImage(bucket, "src.png", "dest/t.webp", {
      previewDestKey: "dest/preview.webp",
    });
    expect(result.previewGenerated).toBe(false);
    expect(result.previewKey).toBeNull();
    expect(bucket.puts).toHaveLength(1);
  });

  test("supports palette-only invocations without a destination", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(600, 400) });

    const result = await processImage(bucket, "src.png", null);
    expect(result.thumbnailGenerated).toBe(false);
    expect(result.palette).toEqual(["#FF0000"]);
    expect(result.thumbhash).toBeTypeOf("string");
    expect(bucket.puts).toHaveLength(0);
  });

  test("rasterizes SVG sources through resvg", async () => {
    const bucket = new FakeBucket();
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">' +
      '<rect width="800" height="600" fill="#00ff00"/></svg>';
    bucket.objects.set("src.svg", { bytes: new TextEncoder().encode(svg) });

    const result = await processImage(bucket, "src.svg", "dest/t.webp");
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.palette[0]).toBe("#00FF00");
    expect(bucket.puts).toHaveLength(1);
    // SVGs carry no EXIF.
    expect(result.exif).toBeNull();
  });

  test("decodes HEIC sources via libheif", async () => {
    const bucket = new FakeBucket();
    const heicBytes = await readFixture("src/fixtures/fixture.heic");
    bucket.objects.set("src.heic", { bytes: heicBytes });

    const result = await processImage(bucket, "src.heic", "dest/t.webp");
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.thumbnailGenerated).toBe(true);
    expect(bucket.puts).toHaveLength(1);
    expect(
      new TextDecoder().decode((bucket.puts[0] as any).bytes.slice(12, 16))
    ).toBe("VP8 ");
  });

  test("reports missing sources distinctly from oversized ones", async () => {
    const bucket = new FakeBucket();
    await expect(
      processImage(bucket, "missing.png", null)
    ).rejects.toBeInstanceOf(ImageSourceMissing);

    bucket.objects.set("big.png", { bytes: new Uint8Array(31 * 1024 * 1024) });
    await expect(processImage(bucket, "big.png", null)).rejects.toBeInstanceOf(
      ImageTooLarge
    );
  });
});

describe("input format detection", () => {
  test("detects HEIC containers by ftyp brand", () => {
    const header = new TextEncoder().encode("....ftypheic........");
    expect(detectImageFormat(header)).toBe("heic");
    const mif1 = new Uint8Array(32);
    mif1.set([0, 0, 0, 24], 0);
    mif1.set(new TextEncoder().encode("ftypmif1"), 4);
    expect(detectImageFormat(mif1)).toBe("heic");
  });

  test("detects SVG prologs including XML declarations and BOMs", () => {
    const encoder = new TextEncoder();
    expect(detectImageFormat(encoder.encode("<svg xmlns=..."))).toBe("svg");
    expect(
      detectImageFormat(encoder.encode('<?xml version="1.0"?><svg ...>'))
    ).toBe("svg");
    expect(detectImageFormat(encoder.encode("\uFEFF<svg ..."))).toBe("svg");
  });

  test("treats everything else as raster", () => {
    const encoder = new TextEncoder();
    expect(detectImageFormat(encoder.encode("%PNG...."))).toBe("raster");
    expect(detectImageFormat(encoder.encode("<svq fake>"))).toBe("raster");
    expect(detectImageFormat(new Uint8Array([0, 1, 2, 3]))).toBe("raster");
    expect(detectImageFormat(new Uint8Array(0))).toBe("raster");
  });
});
