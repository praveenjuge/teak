import { describe, expect, test } from "bun:test";
import { FILE_FORMATS } from "@teak/files-core";
import {
  assertFixtureCoverage,
  fixtureForFormat,
  variantFixtures,
} from "./fixtures";
import { FakeBucket, fakeHttpEtag } from "./testsupport";
import { verifyUploadBytes } from "./verify";

const KEY = "users/u1/cards/upload-pending-v2/source.bin";

const store = (bytes: Uint8Array): FakeBucket => {
  const bucket = new FakeBucket();
  bucket.objects.set(KEY, { bytes });
  return bucket;
};

const verify = (
  bucket: FakeBucket,
  fileName: string,
  requestedMimeType?: string,
  extra: { readText?: boolean } = {}
) =>
  verifyUploadBytes({
    bucket: bucket as unknown as R2Bucket,
    expectedEtag: fakeHttpEtag(
      bucket.objects.get(KEY)?.bytes ?? new Uint8Array()
    ),
    expectedSize: bucket.objects.get(KEY)?.bytes?.length ?? 0,
    fileName,
    requestedMimeType,
    sourceKey: KEY,
    ...extra,
  });

describe("upload verification fixtures", () => {
  test("every declared format has an upload fixture", () => {
    assertFixtureCoverage();
    expect(FILE_FORMATS.length).toBeGreaterThan(40);
  });

  test("every fixture verifies without rejection", async () => {
    for (const format of FILE_FORMATS) {
      const fixture = fixtureForFormat(format.id);
      const result = await verify(
        store(fixture.bytes),
        fixture.fileName,
        fixture.mimeType
      );
      expect(result.format.id).toBe(format.id);
      expect(["decoded", "structural", "claimed"]).toContain(
        result.verificationLevel
      );
    }
  });

  test("text fixtures verify structurally with counts", async () => {
    const fixture = fixtureForFormat("markdown");
    const result = await verify(
      store(fixture.bytes),
      fixture.fileName,
      fixture.mimeType
    );
    expect(result.verificationLevel).toBe("structural");
    expect(result.mimeType).toBe("text/markdown");
    expect(result.facts.lineCount).toBe(4);
    expect(result.facts.wordCount).toBe(3);
  });

  test("gif fixtures decode-verify with trusted dimensions", async () => {
    const fixture = fixtureForFormat("gif");
    const result = await verify(
      store(fixture.bytes),
      fixture.fileName,
      fixture.mimeType
    );
    expect(result.verificationLevel).toBe("decoded");
    expect(result.facts.width).toBe(1);
    expect(result.facts.height).toBe(1);
  });

  test("mp4 fixtures report container facts", async () => {
    const fixture = fixtureForFormat("mp4");
    const result = await verify(
      store(fixture.bytes),
      fixture.fileName,
      fixture.mimeType
    );
    expect(result.verificationLevel).toBe("structural");
    expect(result.facts.container).toBe("mp4");
    expect(result.facts.duration).toBeCloseTo(5, 5);
    expect(result.facts.width).toBe(640);
    expect(result.facts.height).toBe(480);
    expect(result.facts.codec).toBe("avc1");
  });

  test("wav fixtures report pcm duration", async () => {
    const fixture = fixtureForFormat("wave-audio");
    const result = await verify(
      store(fixture.bytes),
      fixture.fileName,
      fixture.mimeType
    );
    expect(result.facts.codec).toBe("pcm");
    expect(result.facts.duration).toBeCloseTo(1, 5);
  });

  test("pdf fixtures report page counts", async () => {
    const fixture = fixtureForFormat("pdf");
    const result = await verify(
      store(fixture.bytes),
      fixture.fileName,
      fixture.mimeType
    );
    expect(result.verificationLevel).toBe("structural");
    expect(result.facts.pageCount).toBe(1);
    expect(result.facts.encrypted).toBeUndefined();
  });

  test("docx fixtures verify as ooxml with archive counts", async () => {
    const fixture = fixtureForFormat("word");
    const result = await verify(
      store(fixture.bytes),
      fixture.fileName,
      fixture.mimeType
    );
    expect(result.verificationLevel).toBe("structural");
    expect(result.facts.container).toBe("ooxml");
    expect(result.facts.archiveFileCount).toBe(2);
  });

  test("pptx fixtures count slides", async () => {
    const fixture = fixtureForFormat("powerpoint");
    const result = await verify(
      store(fixture.bytes),
      fixture.fileName,
      fixture.mimeType
    );
    expect(result.facts.pageCount).toBe(1);
  });

  test("font fixtures report family and format", async () => {
    const fixture = fixtureForFormat("font-truetype");
    const result = await verify(
      store(fixture.bytes),
      fixture.fileName,
      fixture.mimeType
    );
    expect(result.verificationLevel).toBe("structural");
    expect(result.facts.fontFamily).toBe("TestFamily");
    expect(result.facts.fontFormat).toBe("truetype");
  });

  test("markdown reads return decoded content", async () => {
    const fixture = fixtureForFormat("markdown");
    const result = await verify(
      store(fixture.bytes),
      fixture.fileName,
      fixture.mimeType,
      { readText: true }
    );
    expect(result.content).toBe("# Hello\n\nWorld.\n");
  });
});

describe("upload verification failures", () => {
  test("rejects conclusive extension mismatches", async () => {
    const png = fixtureForFormat("png");
    await expect(
      verify(store(png.bytes), "a.pdf", "application/pdf")
    ).rejects.toThrow("invalid_type_mismatch");
    const pdf = fixtureForFormat("pdf");
    await expect(
      verify(store(pdf.bytes), "a.mp3", "audio/mpeg")
    ).rejects.toThrow("invalid_type_mismatch");
  });

  test("rejects mime disagreements before reading bytes", async () => {
    const fixture = fixtureForFormat("markdown");
    await expect(
      verify(store(fixture.bytes), fixture.fileName, "image/png")
    ).rejects.toThrow("invalid_mime_mismatch");
  });

  test("rejects unsupported extensions", async () => {
    const fixture = fixtureForFormat("text");
    await expect(
      verify(store(fixture.bytes), "a.exe", "application/octet-stream")
    ).rejects.toThrow("invalid_file_type");
  });

  test("rejects invalid utf-8 in text claims", async () => {
    await expect(
      verify(store(new Uint8Array([0xc3, 0x28])), "a.md", "text/markdown")
    ).rejects.toThrow("invalid_utf8");
  });

  test("rejects malformed json structurally", async () => {
    const bytes = new TextEncoder().encode("{oops");
    await expect(
      verify(store(bytes), "a.json", "application/json")
    ).rejects.toThrow("invalid_json_structure");
  });

  test("rejects zip claims without a valid directory", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    await expect(
      verify(store(bytes), "a.zip", "application/zip")
    ).rejects.toThrow("invalid_archive_structure");
  });

  test("rejects plain zips claiming office subtypes", async () => {
    const zip = fixtureForFormat("zip");
    await expect(
      verify(
        store(zip.bytes),
        "a.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).rejects.toThrow("invalid_type_mismatch");
  });

  test("accepts opaque design binaries under validated claim", async () => {
    const result = await verify(
      store(variantFixtures.opaqueBytes()),
      "design.fig",
      "application/octet-stream"
    );
    expect(result.verificationLevel).toBe("claimed");
    expect(result.format.id).toBe("figma");
  });

  test("rejects changed sources before verification", async () => {
    const fixture = fixtureForFormat("text");
    const bucket = store(fixture.bytes);
    await expect(
      verifyUploadBytes({
        bucket: bucket as unknown as R2Bucket,
        expectedEtag: '"stale"',
        expectedSize: fixture.bytes.length,
        fileName: fixture.fileName,
        requestedMimeType: fixture.mimeType,
        sourceKey: KEY,
      })
    ).rejects.toThrow("source_changed");
  });

  test("accepts ogg vorbis under the shared audio format", async () => {
    const fixture = variantFixtures.oggOpus();
    const result = await verify(
      store(fixture.bytes),
      fixture.fileName,
      fixture.mimeType
    );
    expect(result.format.id).toBe("other-audio");
    expect(result.facts.codec).toBe("opus");
  });
});
