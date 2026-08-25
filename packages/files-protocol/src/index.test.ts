import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  buildImageSigningPayload,
  buildImageSourceSigningPayload,
  buildMultipartPartSigningPayload,
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
