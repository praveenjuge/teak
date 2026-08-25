import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  buildImageSigningPayload,
  buildImageSourceSigningPayload,
  buildMultipartPartSigningPayload,
  buildUploadSigningPayload,
  FILES_UPLOAD_MAX_TTL_SECONDS,
  isFilesImageRendition,
  isFilesOp,
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
    ).toBe(
      "upload\n1\nPUT\nusers/u/cards/file/x.txt\ntext/plain\n42\n123"
    );
    // Server-generated media signs without a bound size.
    expect(
      buildUploadSigningPayload({
        contentType: "image/jpeg",
        expiresAt: "123",
        key: "users/u/cards/screenshot/s.jpg",
      })
    ).toBe(
      "upload\n1\nPUT\nusers/u/cards/screenshot/s.jpg\nimage/jpeg\n\n123"
    );
    expect(FILES_UPLOAD_MAX_TTL_SECONDS).toBe(900);
  });

  test("accepts only known operations", () => {
    expect(isFilesOp("analyze-image")).toBe(true);
    expect(isFilesOp("process_image")).toBe(false);
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
