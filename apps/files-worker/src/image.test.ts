import { describe, expect, test } from "bun:test";
import { ImageSourceMissing, ImageTooLarge, processImage } from "./image";
import { FakeBucket, makePng } from "./testsupport";

describe("process-image op", () => {
  test("skips thumbnails for small images but still returns dimensions and palette", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(100, 80) });

    const result = await processImage(bucket, "src.png", "dest/t.webp");
    expect(result).toEqual({
      width: 100,
      height: 80,
      thumbnailGenerated: false,
      thumbnailKey: null,
      palette: ["#FF0000"],
    });
    expect(bucket.puts).toHaveLength(0);
  });

  test("resizes large images to bounded webp thumbnails and writes them back", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(600, 400) });

    const result = await processImage(bucket, "src.png", "dest/t.webp");
    expect(result.thumbnailGenerated).toBe(true);
    expect(result.thumbnailKey).toBe("dest/t.webp");
    expect(result.width).toBe(600);
    expect(result.height).toBe(400);
    expect(result.palette.length).toBeGreaterThan(0);

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
  });

  test("supports palette-only invocations without a destination", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("src.png", { bytes: makePng(600, 400) });

    const result = await processImage(bucket, "src.png", null);
    expect(result.thumbnailGenerated).toBe(false);
    expect(result.palette).toEqual(["#FF0000"]);
    expect(bucket.puts).toHaveLength(0);
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
