import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  buildMultipartPartSigningPayload,
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
    expect(isFilesOp("process-image")).toBe(true);
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
});
