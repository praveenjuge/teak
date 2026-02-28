import { describe, expect, test } from "bun:test";
import { normalizeIncomingSharePayloads } from "../../lib/share/normalizeIncomingShare";

describe("normalizeIncomingSharePayloads", () => {
  test("prefers resolved payloads when available", () => {
    const result = normalizeIncomingSharePayloads({
      resolvedSharedPayloads: [
        {
          value: "https://teakvault.com",
          shareType: "url",
          contentUri: "https://teakvault.com",
          contentType: "website",
          contentMimeType: "text/html",
          originalName: null,
          contentSize: null,
        },
      ],
      sharedPayloads: [
        { value: "fallback", shareType: "text", mimeType: "text/plain" },
      ],
    });

    expect(result.source).toBe("resolved");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.kind).toBe("text");
    expect(result.items[0]?.content).toBe("https://teakvault.com");
  });

  test("falls back to raw payloads when resolved payloads are empty", () => {
    const result = normalizeIncomingSharePayloads({
      resolvedSharedPayloads: [],
      sharedPayloads: [
        { value: "Shared note", shareType: "text", mimeType: "text/plain" },
      ],
    });

    expect(result.source).toBe("raw");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.kind).toBe("text");
    expect(result.items[0]?.content).toBe("Shared note");
  });

  test("maps file/media payloads with deterministic filename and mime type", () => {
    const result = normalizeIncomingSharePayloads({
      resolvedSharedPayloads: [],
      sharedPayloads: [
        {
          value: "file:///tmp/sample-track.m4a",
          shareType: "audio",
          mimeType: "audio/mp4",
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    const firstItem = result.items[0];
    expect(firstItem?.kind).toBe("file");
    if (firstItem?.kind === "file") {
      expect(firstItem.fileName).toBe("sample-track.m4a");
      expect(firstItem.mimeType).toBe("audio/mp4");
      expect(firstItem.fileUri).toBe("file:///tmp/sample-track.m4a");
    }
  });

  test("drops unsupported and empty payloads with deterministic reasons", () => {
    const result = normalizeIncomingSharePayloads({
      resolvedSharedPayloads: [],
      sharedPayloads: [
        { value: "", shareType: "text", mimeType: "text/plain" },
        {
          value: "data",
          shareType: "unknown" as any,
          mimeType: "application/json",
        },
      ],
    });

    expect(result.items).toHaveLength(0);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped[0]?.reason).toBe("EMPTY_VALUE");
    expect(result.dropped[1]?.reason).toBe("UNSUPPORTED_TYPE");
  });
});
