import { describe, expect, test } from "bun:test";
import {
  buildCardObjectKey,
  buildFileSigningPayload,
  buildFilesOpSigningPayload,
  buildImageSigningPayload,
  buildImageSourceSigningPayload,
  buildMultipartPartSigningPayload,
  buildUploadSigningPayload,
  cardEmbeddingDocument,
  cardEmbeddingQuery,
  FILES_EDGE_CACHE_CONTROL,
  FILES_OBJECT_KEY_ROOTS,
  FILES_PRIVATE_CACHE_CONTROL,
  FILES_SIGNED_URL_MIN_VALIDITY_SECONDS,
  FILES_UPLOAD_MAX_TTL_SECONDS,
  isFilesImageRendition,
  isFilesInspectMode,
  isFilesOp,
  isScannedPdf,
  parseCardObjectKey,
  truncateForEmbedding,
  vectorNamespaceForUser,
  vectorShardBinding,
} from "./index";

describe("files protocol", () => {
  test("builds an unambiguous body-bound signing payload", () => {
    expect(
      buildFilesOpSigningPayload({
        bodySha256: "abc",
        expiresAt: "123",
        requestId: "req-1",
      })
    ).toBe("files-op\n1\nreq-1\n123\nabc");
  });

  test("binds upload signatures to method, key, type, size, and expiry", () => {
    expect(
      buildUploadSigningPayload({
        contentType: "text/plain",
        expiresAt: "123",
        key: "users/u/cards/file/x.txt",
        size: 42,
      })
    ).toBe("upload\n1\nPUT\nusers/u/cards/file/x.txt\ntext/plain\n42\n123");
    expect(
      buildUploadSigningPayload({
        contentType: "image/jpeg",
        expiresAt: "123",
        key: "users/u/cards/screenshot/s.jpg",
      })
    ).toBe("upload\n1\nPUT\nusers/u/cards/screenshot/s.jpg\nimage/jpeg\n\n123");
    expect(FILES_UPLOAD_MAX_TTL_SECONDS).toBe(900);
  });

  test("accepts only known operations", () => {
    expect(isFilesOp("analyze-image")).toBe(true);
    expect(isFilesOp("cleanup-stale-pending-uploads")).toBe(true);
    expect(isFilesOp("cleanup-stale-pending-upload-page")).toBe(false);
    expect(isFilesOp("process_image")).toBe(false);
  });

  test("accepts pdf as an inspect mode alongside the existing modes", () => {
    for (const mode of ["css", "pdf", "text", "zip"]) {
      expect(isFilesInspectMode(mode)).toBe(true);
    }
    expect(isFilesInspectMode("docx")).toBe(false);
    expect(isFilesInspectMode(undefined)).toBe(false);
  });

  test("binds multipart signatures to an exact key, upload, and part", () => {
    expect(
      buildMultipartPartSigningPayload({
        expiresAt: "123",
        key: "users/u/file..png",
        partNumber: 2,
        uploadId: "upload-1",
      })
    ).toBe("multipart-part\n1\nusers/u/file..png\nupload-1\n2\n123");
  });

  test("binds image signatures to the rendition and immutable object key", () => {
    expect(
      buildImageSigningPayload({
        expiresAt: "123",
        key: "users/u/cards/c/file.png",
        rendition: "grid",
      })
    ).toBe("image\n1\ngrid\nusers/u/cards/c/file.png\n123");
    expect(isFilesImageRendition("detail")).toBe(true);
    expect(isFilesImageRendition("original")).toBe(false);
  });

  test("binds private image-source authorization to an object key", () => {
    expect(
      buildImageSourceSigningPayload({
        expiresAt: "123",
        key: "users/u/cards/c/file.png",
      })
    ).toBe("image-source\n1\nusers/u/cards/c/file.png\n123");
  });
});

import { readFilesAiGenerationFacts } from "./metadata";

test.each([
  { validationRetryCount: 3 },
  { validationRetryCount: -1 },
  { validationRetryCount: 1, usage: { inputTokens: -1 } },
  { validationRetryCount: 1, usage: { outputTokens: "secret" } },
  { validationRetryCount: 1, usage: { inputTokens: Number.POSITIVE_INFINITY } },
])("rejects invalid AI diagnostics %p", (value) => {
  expect(readFilesAiGenerationFacts(value)).toBeNull();
});
test.each([
  ["no page count", { text: "" }, false],
  ["one page, no text layer", { pageCount: 1, text: "" }, true],
  [
    "two pages with only a footer",
    { pageCount: 2, text: "Scanned by OfficeScan 3000\n\fScanned by" },
    true,
  ],
  [
    "a one-page letter",
    { pageCount: 1, text: "Dear tenant, the lease renews on 1 May." },
    false,
  ],
  [
    "300 pages, 3 short lines",
    { pageCount: 300, text: "a b c ".repeat(30) },
    true,
  ],
  [
    "a 900-page text PDF read to 500 pages",
    { pageCount: 900, text: "word ".repeat(2600) },
    false,
  ],
])("a PDF with %s is scanned: %p", (_name, pdf, scanned) => {
  expect(isScannedPdf(pdf)).toBe(scanned);
});

test("copies only numeric AI diagnostics", () => {
  expect(
    readFilesAiGenerationFacts({
      validationRetryCount: 2,
      usage: { inputTokens: 4, outputTokens: 2, prompt: "private" },
      content: "private",
    })
  ).toEqual({
    validationRetryCount: 2,
    usage: { inputTokens: 4, outputTokens: 2 },
  });
});

describe("card embeddings", () => {
  test("wraps card text and queries in EmbeddingGemma's retrieval prompts", () => {
    expect(cardEmbeddingQuery("  wood for furniture ")).toBe(
      "task: search result | query: wood for furniture"
    );
    expect(cardEmbeddingDocument("Teak\nA tropical hardwood\n")).toBe(
      "title: none | text: Teak\nA tropical hardwood"
    );
  });

  test("names shard bindings and keeps namespaces within Vectorize's 64 bytes", () => {
    expect(vectorShardBinding(0)).toBe("CARD_VECTORS_0");
    expect(
      vectorNamespaceForUser("teak_ns767yc5e1fywwsf7adk76q2dd8g905a")
    ).toBe("teak_ns767yc5e1fywwsf7adk76q2dd8g905a");
    expect(vectorNamespaceForUser("x".repeat(64))).toBe("x".repeat(64));
    expect(vectorNamespaceForUser("é".repeat(33))).toBeNull();
    expect(vectorNamespaceForUser("")).toBeNull();
  });

  test("cuts card text to what EmbeddingGemma reads, by its densest scripts", () => {
    expect(truncateForEmbedding("A short note")).toBe("A short note");
    expect(truncateForEmbedding("a".repeat(5000))).toHaveLength(1440);
    expect(Array.from(truncateForEmbedding("漢".repeat(5000)))).toHaveLength(
      400
    );
    const emoji = truncateForEmbedding("🌿".repeat(5000));
    expect(Array.from(emoji)).toHaveLength(400);
    expect(emoji.length).toBe(800);
    expect(cardEmbeddingDocument("b".repeat(5000))).toBe(
      `title: none | text: ${"b".repeat(1440)}`
    );
  });
});

describe("file storage contract", () => {
  test("signs file urls over key, expiry, content type and disposition", () => {
    expect(
      buildFileSigningPayload({
        key: "users/abc/cards/file/x.png",
        exp: "1700000000",
        contentType: "image/png",
        contentDisposition: "inline",
      })
    ).toBe("users/abc/cards/file/x.png\n1700000000\nimage/png\ninline");
    expect(
      buildFileSigningPayload({ key: "users/abc/cards/file/x.png", exp: "1" })
    ).toBe("users/abc/cards/file/x.png\n1\n\n");
  });

  test("caches file responses for a day less than a signed url stays valid", () => {
    expect(FILES_PRIVATE_CACHE_CONTROL).toBe(
      "private, max-age=518400, immutable"
    );
    expect(FILES_EDGE_CACHE_CONTROL).toBe("public, max-age=518400, immutable");
    expect(FILES_SIGNED_URL_MIN_VALIDITY_SECONDS).toBe(604_800);
  });

  test("builds card object keys under the user's hashed prefix", () => {
    expect(
      buildCardObjectKey({
        envPrefix: "dev/",
        userId: "user_1",
        cardId: "card_9",
        role: "file",
        fileName: "My photo (1).png",
      })
    ).toMatch(
      /^dev\/users\/1l7d0vx\/cards\/card_9\/file\/[0-9a-f-]{36}-My-photo-1-\.png$/
    );
    expect(
      buildCardObjectKey({ envPrefix: "", userId: "user_1", role: "thumbnail" })
    ).toMatch(/^users\/1l7d0vx\/cards\/pending\/thumbnail\/[0-9a-f-]{36}$/);
  });

  test("reads the card and role back from a card object key", () => {
    const key = buildCardObjectKey({
      envPrefix: "dev/",
      userId: "user_1",
      cardId: "card_9",
      role: "file",
    });
    expect(parseCardObjectKey(key)).toEqual({ cardId: "card_9", role: "file" });
    expect(
      parseCardObjectKey("users/1l7d0vx/cards/pending/thumbnail/x")
    ).toEqual({ role: "thumbnail" });
    expect(parseCardObjectKey("exports/user/archive.zip")).toEqual({});
    expect(parseCardObjectKey("")).toEqual({});
  });

  test("accepts keys under the user and export roots of both environments", () => {
    expect([...FILES_OBJECT_KEY_ROOTS].sort()).toEqual([
      "dev/exports/",
      "dev/users/",
      "exports/",
      "users/",
    ]);
  });
});
