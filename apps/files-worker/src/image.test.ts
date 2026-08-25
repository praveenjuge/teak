import { describe, expect, test } from "bun:test";
import {
  detectImageFormat,
  ImageDecodeFailed,
  ImageSourceMissing,
  ImageTooLarge,
  MAX_DECODE_PIXELS,
  processImage,
  readRasterDimensions,
} from "./image";
import { FakeBucket, makePng, readFixture } from "./testsupport";

const derivativePuts = (bucket: FakeBucket) =>
  bucket.puts.filter((put) => !put.key.endsWith(".processing.json"));

describe("process-image op", () => {
  test("skips thumbnails for small images but still returns dimensions and palette", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(100, 80) });

    const result = await processImage(bucket, "src.png", "dest/t.webp");
    expect(result).toMatchObject({
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
    expect(result.provenance).toMatchObject({
      processorVersion: "2026-08-24.1",
      transformVersion: "image-v2",
    });
    expect(derivativePuts(bucket)).toHaveLength(0);
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

    expect(derivativePuts(bucket)).toHaveLength(1);
    const put = derivativePuts(bucket)[0];
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

    expect(
      derivativePuts(bucket)
        .map((p) => (p as any).key)
        .sort()
    ).toEqual(["dest/preview.webp", "dest/t.webp"]);
    for (const put of derivativePuts(bucket)) {
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
    expect(derivativePuts(bucket)).toHaveLength(1);
  });

  test("supports palette-only invocations without a destination", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(600, 400) });

    const result = await processImage(bucket, "src.png", null);
    expect(result.thumbnailGenerated).toBe(false);
    expect(result.palette).toEqual(["#FF0000"]);
    expect(result.thumbhash).toBeTypeOf("string");
    expect(derivativePuts(bucket)).toHaveLength(0);
  });

  test("reuses current derivatives and regenerates a missing derivative", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(600, 400) });
    const first = await processImage(bucket, "src.png", "dest/t.webp");
    const putsAfterFirst = derivativePuts(bucket).length;

    const cached = await processImage(bucket, "src.png", "dest/t.webp");
    expect(cached.provenance.generatedAt).toBe(first.provenance.generatedAt);
    expect(derivativePuts(bucket)).toHaveLength(putsAfterFirst);

    bucket.objects.delete("dest/t.webp");
    const repaired = await processImage(bucket, "src.png", "dest/t.webp");
    expect(repaired.thumbnailGenerated).toBe(true);
    expect(derivativePuts(bucket).length).toBe(putsAfterFirst + 1);
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
    expect(derivativePuts(bucket)).toHaveLength(1);
    // SVGs carry no EXIF.
    expect(result.exif).toBeNull();
  });

  test("decodes HEIC sources via libheif", async () => {
    const bucket = new FakeBucket();
    const heicBytes = await readFixture(
      new URL("./fixtures/fixture.heic", import.meta.url).pathname
    );
    bucket.objects.set("src.heic", { bytes: heicBytes });

    const result = await processImage(bucket, "src.heic", "dest/t.webp");
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.thumbnailGenerated).toBe(true);
    expect(derivativePuts(bucket)).toHaveLength(1);
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

  test("rejects decompression-bomb dimensions before Photon decodes them", async () => {
    const bucket = new FakeBucket();
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    header.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
    const view = new DataView(header.buffer);
    view.setUint32(16, MAX_DECODE_PIXELS);
    view.setUint32(20, 2);
    bucket.objects.set("bomb.png", { bytes: header });

    await expect(processImage(bucket, "bomb.png", null)).rejects.toBeInstanceOf(
      ImageTooLarge
    );
  });

  test("classifies malformed raster bytes as a decode failure", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("broken.jpg", {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    await expect(
      processImage(bucket, "broken.jpg", null)
    ).rejects.toBeInstanceOf(ImageDecodeFailed);
  });

  test("serializes concurrent large-image processing", async () => {
    const bytes = makePng(4000, 3000);
    const jobs = Array.from({ length: 3 }, (_, index) => {
      const bucket = new FakeBucket();
      const sourceKey = `concurrent-${index}.png`;
      bucket.objects.set(sourceKey, { bytes });
      return processImage(bucket, sourceKey, `dest/${index}.webp`, {
        previewDestKey: `preview/${index}.webp`,
      });
    });

    const results = await Promise.all(jobs);
    expect(results.every((result) => result.thumbnailGenerated)).toBe(true);
  });
});

describe("input format detection", () => {
  test("reads PNG dimensions without decoding pixels", () => {
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    header.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
    const view = new DataView(header.buffer);
    view.setUint32(16, 1200);
    view.setUint32(20, 630);
    expect(readRasterDimensions(header)).toEqual({ height: 630, width: 1200 });
  });

  test("reads JPEG dimensions from a start-of-frame segment", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x02, 0x80, 0x05, 0x00, 0x01,
      0x01, 0x11, 0x00, 0xff, 0xd9,
    ]);
    expect(readRasterDimensions(jpeg)).toEqual({ height: 640, width: 1280 });
  });

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
