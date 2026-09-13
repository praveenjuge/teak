import { describe, expect, test } from "bun:test";
import {
  FILES_CAPABILITY_FEATURES,
  FILES_OPS,
  type FilesOp,
  type FilesOpParams,
  type FilesOpResults,
  isFilesCapabilityFeature,
  isFilesOpParams,
} from "./index";

const validParams: { [Op in FilesOp]: FilesOpParams[Op] } = {
  capabilities: {},
  "analyze-image": { sourceKey: "users/a/file.png" },
  "analyze-image-content": { sourceKey: "users/a/file.png" },
  "abort-multipart": { key: "users/a/file.zip", uploadId: "upload-1" },
  "build-export": {
    manifestKey: "users/a/manifest.json",
    artifactKey: "users/a/export.zip",
    fileName: "export.zip",
  },
  "complete-multipart": {
    key: "users/a/file.zip",
    uploadId: "upload-1",
    expectedSize: 10,
    parts: [{ partNumber: 1, etag: "etag-1" }],
  },
  "create-multipart": { key: "users/a/file.zip", contentType: "text/plain" },
  "delete-object": { key: "users/a/file.zip" },
  "delete-objects": { keys: ["users/a/one", "users/a/two"] },
  "extract-import-files": {
    archiveKey: "users/a/archive.zip",
    entries: [{ path: "files/a.png", destinationKey: "users/a/a.png" }],
    sourceEtag: "etag-1",
  },
  "finalize-image-upload": {
    sourceKey: "users/a/pending",
    destinationKey: "users/a/stored",
    expectedEtag: "etag-1",
    expectedSize: 10,
  },
  "finalize-upload": {
    sourceKey: "users/a/pending",
    destinationKey: "users/a/stored",
    fileName: "notes.md",
    readText: true,
    requestedMimeType: "text/markdown",
  },
  "generate-image-metadata": { sourceKey: "users/a/file.png", title: "Hi" },
  "head-object": { key: "users/a/file.zip" },
  inspect: {
    sourceKey: "users/a/file.zip",
    mode: "zip",
    formatId: "zip",
    maxBytes: 1024,
  },
  "list-objects": { prefix: "users/a/", limit: 100 },
  "transcribe-audio": { sourceKey: "users/a/audio.m4a", mimeType: "audio/mp4" },
  "index-import-source": {
    sourceKey: "users/a/archive.zip",
    expectedSize: 100,
    mode: "archive",
  },
  "read-import-markdown": {
    sourceKey: "users/a/archive.zip",
    sourceEtag: "etag-1",
    path: "notes/one.md",
  },
};

describe("operation parameter maps", () => {
  test("every declared op has a params fixture", () => {
    expect(Object.keys(validParams).sort()).toEqual([...FILES_OPS].sort());
  });

  test("result maps cover every declared op", () => {
    const results: Record<FilesOp, keyof FilesOpResults> = {
      capabilities: "capabilities",
      "analyze-image": "analyze-image",
      "analyze-image-content": "analyze-image-content",
      "abort-multipart": "abort-multipart",
      "build-export": "build-export",
      "complete-multipart": "complete-multipart",
      "create-multipart": "create-multipart",
      "delete-object": "delete-object",
      "delete-objects": "delete-objects",
      "extract-import-files": "extract-import-files",
      "finalize-image-upload": "finalize-image-upload",
      "finalize-upload": "finalize-upload",
      "generate-image-metadata": "generate-image-metadata",
      "head-object": "head-object",
      "index-import-source": "index-import-source",
      inspect: "inspect",
      "list-objects": "list-objects",
      "read-import-markdown": "read-import-markdown",
      "transcribe-audio": "transcribe-audio",
    };
    expect(Object.keys(results).sort()).toEqual([...FILES_OPS].sort());
  });

  test("accepts every valid params fixture", () => {
    for (const op of FILES_OPS) {
      expect(isFilesOpParams(op, validParams[op])).toBe(true);
    }
  });

  test("rejects non-object params", () => {
    for (const op of FILES_OPS) {
      expect(isFilesOpParams(op, null)).toBe(false);
      expect(isFilesOpParams(op, [])).toBe(false);
      expect(isFilesOpParams(op, "params")).toBe(false);
    }
  });

  test("rejects missing required fields", () => {
    expect(isFilesOpParams("analyze-image", {})).toBe(false);
    expect(isFilesOpParams("abort-multipart", { key: "k" })).toBe(false);
    expect(isFilesOpParams("delete-object", {})).toBe(false);
    expect(isFilesOpParams("head-object", { key: "" })).toBe(false);
    expect(isFilesOpParams("finalize-upload", { sourceKey: "a" })).toBe(false);
    expect(
      isFilesOpParams("read-import-markdown", {
        sourceKey: "a",
        sourceEtag: "e",
      })
    ).toBe(false);
  });

  test("rejects mistyped fields", () => {
    expect(isFilesOpParams("analyze-image", { sourceKey: 42 })).toBe(false);
    expect(
      isFilesOpParams("finalize-upload", {
        sourceKey: "a",
        destinationKey: "b",
        readText: "yes",
      })
    ).toBe(false);
    expect(
      isFilesOpParams("inspect", {
        sourceKey: "a",
        mode: "zip",
        maxBytes: 1.5,
      })
    ).toBe(false);
    expect(
      isFilesOpParams("generate-image-metadata", {
        sourceKey: "a",
        title: "x".repeat(2001),
      })
    ).toBe(false);
  });

  test("rejects out-of-range bounds", () => {
    expect(
      isFilesOpParams("inspect", {
        sourceKey: "a",
        mode: "zip",
        maxBytes: 0,
      })
    ).toBe(false);
    expect(
      isFilesOpParams("inspect", {
        sourceKey: "a",
        mode: "zip",
        maxBytes: 64 * 1024 * 1024 + 1,
      })
    ).toBe(false);
    expect(
      isFilesOpParams("inspect", {
        sourceKey: "a",
        mode: "pdf",
        maxBytes: 10,
      })
    ).toBe(false);
    expect(
      isFilesOpParams("complete-multipart", {
        key: "k",
        uploadId: "u",
        expectedSize: -1,
        parts: [{ partNumber: 1, etag: "e" }],
      })
    ).toBe(false);
    expect(
      isFilesOpParams("complete-multipart", {
        key: "k",
        uploadId: "u",
        expectedSize: 1,
        parts: [],
      })
    ).toBe(false);
    expect(isFilesOpParams("delete-objects", { keys: [] })).toBe(false);
    expect(
      isFilesOpParams("list-objects", { prefix: "users/a/", limit: 1001 })
    ).toBe(false);
    expect(isFilesOpParams("list-objects", { prefix: "other/a/" })).toBe(false);
    expect(
      isFilesOpParams("extract-import-files", {
        archiveKey: "a",
        entries: [],
      })
    ).toBe(false);
  });

  test("accepts optional fields and edge bounds", () => {
    expect(isFilesOpParams("create-multipart", { key: "k" })).toBe(true);
    expect(
      isFilesOpParams("list-objects", {
        prefix: "dev/users/a/",
        limit: 1000,
        cursor: "cursor",
      })
    ).toBe(true);
    expect(
      isFilesOpParams("index-import-source", {
        sourceKey: "a",
        expectedSize: 1,
        mode: "raindrop",
        cursor: 0,
      })
    ).toBe(true);
    expect(isFilesOpParams("capabilities", { extra: true })).toBe(true);
  });
});

describe("capability features", () => {
  test("feature flags are a stable allowlist", () => {
    expect([...FILES_CAPABILITY_FEATURES]).toEqual([
      "verified-finalization",
      "worker-import-transport",
      "verified-text-reads",
      "media-facts",
      "ai-receipts",
    ]);
    for (const feature of FILES_CAPABILITY_FEATURES) {
      expect(isFilesCapabilityFeature(feature)).toBe(true);
    }
    expect(isFilesCapabilityFeature("unknown")).toBe(false);
    expect(isFilesCapabilityFeature(null)).toBe(false);
  });
});
