import { describe, expect, test } from "bun:test";
import { PdfSourceMissing, PdfTooLarge, processPdf } from "./pdf";
import { FakeBucket, readFixture } from "./testsupport";
import { MAX_PDF_BYTES } from "./wasm";

const fixtureBytes = (): Promise<Uint8Array> =>
  readFixture("src/fixtures/fixture.pdf");

describe("process-pdf op", () => {
  test("renders the first page into a lossy webp thumbnail with facts", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("doc.pdf", { bytes: await fixtureBytes() });

    const result = await processPdf(bucket, "doc.pdf", "dest/t.webp");
    expect(result.pageCount).toBe(1);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.thumbnailGenerated).toBe(true);
    expect(result.thumbnailKey).toBe("dest/t.webp");
    expect(result.palette.length).toBeGreaterThan(0);
    expect(typeof result.thumbhash).toBe("string");

    expect(bucket.puts).toHaveLength(1);
    const put = bucket.puts[0];
    expect((put as any).key).toBe("dest/t.webp");
    expect((put as any).httpMetadata?.contentType).toBe("image/webp");
    // Lossy WebP (VP8 chunk) container magic.
    expect(new TextDecoder().decode((put as any).bytes.slice(8, 16))).toBe(
      "WEBPVP8 "
    );
  });

  test("supports fact-only invocations without a destination", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("doc.pdf", { bytes: await fixtureBytes() });

    const result = await processPdf(bucket, "doc.pdf", null);
    expect(result.pageCount).toBe(1);
    expect(result.thumbnailGenerated).toBe(false);
    expect(result.thumbnailKey).toBeNull();
    expect(bucket.puts).toHaveLength(0);
  });

  test("missing and oversized sources fall back distinctly", async () => {
    const bucket = new FakeBucket();
    await expect(
      processPdf(bucket, "gone.pdf", "dest/t.webp")
    ).rejects.toBeInstanceOf(PdfSourceMissing);

    bucket.objects.set("huge.pdf", {
      bytes: new Uint8Array(MAX_PDF_BYTES + 1),
    });
    await expect(
      processPdf(bucket, "huge.pdf", "dest/t.webp")
    ).rejects.toBeInstanceOf(PdfTooLarge);
  });

  test("malformed documents raise pdf_parse_failed", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("bad.pdf", {
      bytes: new TextEncoder().encode("%PDF-1.4 not really"),
    });
    await expect(processPdf(bucket, "bad.pdf", null)).rejects.toThrow(
      "pdf_parse_failed"
    );
  });
});
