import { describe, expect, test } from "bun:test";
import { validateFinalizeUpload } from "../../card/uploadCardAction";
import { buildR2ObjectKey } from "../../storage/r2";

describe("worker-backed card upload finalization", () => {
  const userId = "user-1";

  test("accepts a valid user-scoped key including consecutive dots", () => {
    const fileKey = buildR2ObjectKey({
      userId,
      cardId: "upload-pending-v2",
      role: "file",
      fileName: "design..final.png",
    });
    expect(
      validateFinalizeUpload(userId, {
        fileEtag: '"etag-1"',
        fileKey,
        fileName: "design..final.png",
        fileSize: 128,
        fileType: "image/png",
      })
    ).toMatchObject({
      fileName: "design..final.png",
      markdown: false,
      requestedMimeType: "image/png",
    });
  });

  test("rejects storage keys belonging to another user", () => {
    const fileKey = buildR2ObjectKey({
      userId: "other-user",
      role: "file",
      fileName: "photo.png",
    });
    expect(() =>
      validateFinalizeUpload(userId, {
        fileKey,
        fileName: "photo.png",
        fileSize: 128,
        fileType: "image/png",
      })
    ).toThrow("Uploaded file key does not belong to the current user");
  });

  test("rejects malformed etags and oversized files before storage work", () => {
    const fileKey = buildR2ObjectKey({ userId, role: "file" });
    expect(() =>
      validateFinalizeUpload(userId, {
        fileEtag: "bad etag",
        fileKey,
        fileName: "photo.png",
        fileSize: 128,
        fileType: "image/png",
      })
    ).toThrow("Uploaded file ETag is invalid");
  });
});
