import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { FILES_EXPORT_MANIFEST_VERSION } from "@teak/files-protocol";
import { unzipSync } from "fflate";
import { FakeBucket, makePng } from "../test/testsupport";
import {
  buildExportIntoBucket,
  ExportManifestInvalid,
  ExportTooLarge,
  parseExportManifest,
} from "./export";

// The resume tests use small parts, so one part plus a short last part takes
// kilobytes instead of the 33 MiB the 32 MiB production part size needs.
const PART_BYTES = 64 * 1024;
const LARGE_BYTES = PART_BYTES + 2 * 1024;

const encodeBase64 = (text: string): string =>
  Buffer.from(text, "utf8").toString("base64");

describe("export manifest parsing", () => {
  const valid = {
    v: FILES_EXPORT_MANIFEST_VERSION,
    maxBytes: 1024,
    entries: [{ path: "cards.json", contentBase64: encodeBase64("{}") }],
  };

  test("accepts a structurally valid manifest", () => {
    expect(parseExportManifest(JSON.stringify(valid))).toEqual(valid);
  });

  test("rejects malformed json, bad versions, and unsafe paths", () => {
    expect(() => parseExportManifest("not-json")).toThrow(
      ExportManifestInvalid
    );
    expect(() =>
      parseExportManifest(JSON.stringify({ ...valid, v: 99 }))
    ).toThrow(ExportManifestInvalid);
    expect(() =>
      parseExportManifest(
        JSON.stringify({
          ...valid,
          entries: [{ path: "../escape", contentBase64: "" }],
        })
      )
    ).toThrow(ExportManifestInvalid);
    expect(() =>
      parseExportManifest(
        JSON.stringify({ ...valid, entries: [{ path: "/abs" }] })
      )
    ).toThrow(ExportManifestInvalid);
    expect(() =>
      parseExportManifest(JSON.stringify({ ...valid, entries: [{}] }))
    ).toThrow(ExportManifestInvalid);
  });
});

describe("build-export op", () => {
  test("streams inline and stored entries into a valid zip archive", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("users/a/file/a.png", { bytes: makeZipPng() });

    const manifest = {
      v: FILES_EXPORT_MANIFEST_VERSION,
      maxBytes: 1024 * 1024 * 1024,
      entries: [
        { path: "manifest.json", contentBase64: encodeBase64('{"ok":true}') },
        { path: "cards.json", contentBase64: encodeBase64('{"cards":[]}') },
        { path: "files/a.png", storageKey: "users/a/file/a.png" },
      ],
    };
    bucket.objects.set("exports/manifest.json", {
      bytes: new TextEncoder().encode(JSON.stringify(manifest)),
    });

    const result = await buildExportIntoBucket(
      bucket,
      "exports/manifest.json",
      "exports/artifact.zip",
      "teak-export.zip"
    );

    expect(result.filesIncluded).toBe(1);
    expect(result.filesOmitted).toBe(0);
    expect(result.omittedPaths).toEqual([]);
    expect(result.artifactBytes).toBeGreaterThan(0);

    const zip = bucket.multipartCompletions.find(
      (entry) => entry.key === "exports/artifact.zip"
    );
    expect(zip).toBeDefined();

    const unzipped = unzipSync(zip!.bytes);
    expect(Object.keys(unzipped).sort()).toEqual([
      "cards.json",
      "files/a.png",
      "manifest.json",
    ]);
    expect(new TextDecoder().decode(unzipped["manifest.json"])).toBe(
      '{"ok":true}'
    );
    expect(unzipped["files/a.png"]).toEqual(makeZipPng());
  });

  test("omits missing files after retries and reports them by path", async () => {
    const bucket = new FakeBucket();
    const manifest = {
      v: FILES_EXPORT_MANIFEST_VERSION,
      maxBytes: 1024 * 1024 * 1024,
      entries: [
        { path: "cards.json", contentBase64: encodeBase64("x") },
        { path: "files/missing.png", storageKey: "users/a/file/gone.png" },
      ],
    };
    bucket.objects.set("m.json", {
      bytes: new TextEncoder().encode(JSON.stringify(manifest)),
    });

    const result = await buildExportIntoBucket(
      bucket,
      "m.json",
      "out.zip",
      "teak-export.zip"
    );
    expect(result.filesIncluded).toBe(0);
    expect(result.filesOmitted).toBe(1);
    expect(result.omittedPaths).toEqual(["files/missing.png"]);

    const zip = bucket.multipartCompletions[0];
    const unzipped = unzipSync(zip.bytes);
    expect(Object.keys(unzipped)).toEqual(["cards.json"]);
  });

  test("aborts with a size error when the manifest exceeds its cap", async () => {
    const bucket = new FakeBucket();
    const manifest = {
      v: FILES_EXPORT_MANIFEST_VERSION,
      maxBytes: 10,
      entries: [
        { path: "big.bin", contentBase64: encodeBase64("0123456789abcdef") },
      ],
    };
    bucket.objects.set("m2.json", {
      bytes: new TextEncoder().encode(JSON.stringify(manifest)),
    });

    await expect(
      buildExportIntoBucket(bucket, "m2.json", "out.zip", "t.zip")
    ).rejects.toBeInstanceOf(ExportTooLarge);
    expect(bucket.multipartCompletions).toHaveLength(0);
  });

  test("resumes from checkpointed parts after a transient upload failure", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("large.bin", {
      bytes: new Uint8Array(LARGE_BYTES),
    });
    bucket.objects.set("resume-manifest.json", {
      bytes: new TextEncoder().encode(
        JSON.stringify({
          v: FILES_EXPORT_MANIFEST_VERSION,
          maxBytes: 64 * 1024 * 1024,
          entries: [{ path: "large.bin", storageKey: "large.bin" }],
        })
      ),
    });
    bucket.failMultipartPartOnce.add(2);
    await expect(
      buildExportIntoBucket(
        bucket,
        "resume-manifest.json",
        "resume.zip",
        "resume.zip",
        PART_BYTES
      )
    ).rejects.toThrow("multipart_part_2_failed");
    expect(bucket.objects.has("resume.zip.checkpoint.json")).toBe(true);

    const result = await buildExportIntoBucket(
      bucket,
      "resume-manifest.json",
      "resume.zip",
      "resume.zip",
      PART_BYTES
    );
    expect(result.filesIncluded).toBe(1);
    expect(bucket.objects.has("resume.zip.checkpoint.json")).toBe(false);
    expect(bucket.objects.has("resume.zip.result.json")).toBe(true);
    expect(bucket.multipartCompletions).toHaveLength(1);
  });

  test("a resumed archive stays valid when a file goes missing on the retry", async () => {
    const bucket = new FakeBucket();
    const large = patternedBytes(LARGE_BYTES);
    bucket.objects.set("small.txt", {
      bytes: new TextEncoder().encode("small file"),
    });
    bucket.objects.set("large.bin", { bytes: large });
    bucket.objects.set("m.json", {
      bytes: new TextEncoder().encode(
        JSON.stringify({
          v: FILES_EXPORT_MANIFEST_VERSION,
          maxBytes: 64 * 1024 * 1024,
          entries: [
            { path: "small.txt", storageKey: "small.txt" },
            { path: "large.bin", storageKey: "large.bin" },
          ],
        })
      ),
    });
    bucket.failMultipartPartOnce.add(2);
    await expect(
      buildExportIntoBucket(bucket, "m.json", "out.zip", "out.zip", PART_BYTES)
    ).rejects.toThrow("multipart_part_2_failed");

    bucket.failKeys.add("small.txt");
    const result = await buildExportIntoBucket(
      bucket,
      "m.json",
      "out.zip",
      "out.zip",
      PART_BYTES
    );

    expect(result.omittedPaths).toEqual(["small.txt"]);
    const unzipped = unzipSync(bucket.storedBytes("out.zip")!);
    expect(Object.keys(unzipped)).toEqual(["large.bin"]);
    expect(Buffer.compare(unzipped["large.bin"], large)).toBe(0);
  });

  test("a resumed archive matches one built in a single attempt", async () => {
    const manifest = {
      v: FILES_EXPORT_MANIFEST_VERSION,
      maxBytes: 64 * 1024 * 1024,
      entries: [
        { path: "cards.json", contentBase64: encodeBase64('{"cards":[]}') },
        { path: "large.bin", storageKey: "large.bin" },
      ],
    };
    const seed = (bucket: FakeBucket) => {
      bucket.objects.set("large.bin", {
        bytes: patternedBytes(LARGE_BYTES),
      });
      bucket.objects.set("m.json", {
        bytes: new TextEncoder().encode(JSON.stringify(manifest)),
      });
    };
    const startedAt = new Date("2026-01-01T10:00:00Z");

    setSystemTime(startedAt);
    const reference = new FakeBucket();
    seed(reference);
    await buildExportIntoBucket(
      reference,
      "m.json",
      "out.zip",
      "out.zip",
      PART_BYTES
    );

    const bucket = new FakeBucket();
    seed(bucket);
    bucket.failMultipartPartOnce.add(2);
    await expect(
      buildExportIntoBucket(bucket, "m.json", "out.zip", "out.zip", PART_BYTES)
    ).rejects.toThrow("multipart_part_2_failed");
    setSystemTime(new Date("2026-01-01T11:00:00Z"));
    await buildExportIntoBucket(
      bucket,
      "m.json",
      "out.zip",
      "out.zip",
      PART_BYTES
    );

    expect(
      Buffer.compare(
        bucket.storedBytes("out.zip")!,
        reference.storedBytes("out.zip")!
      )
    ).toBe(0);
  });
});

afterEach(() => {
  setSystemTime();
});

const patternedBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = index % 251;
  }
  return bytes;
};

const makeZipPng = (): Uint8Array => makePng(1, 1);
