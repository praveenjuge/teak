// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

describe("card/generateUploadUrl.ts", () => {
  let generateUploadUrl: any;
  let r2Module: any;
  let originalGenerateUploadUrl: any;

  beforeEach(async () => {
    r2Module = await import("../../storage/r2");
    originalGenerateUploadUrl = r2Module.r2.generateUploadUrl;
    r2Module.r2.generateUploadUrl = mock().mockResolvedValue({
      key: "users/2u4/cards/pending/file/upload-key",
      url: "https://upload",
    });
    generateUploadUrl = (await import("../../card/generateUploadUrl"))
      .generateUploadUrl;
  });

  afterEach(() => {
    r2Module.r2.generateUploadUrl = originalGenerateUploadUrl;
  });

  test("throws when unauthenticated", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any;
    const handler = (generateUploadUrl as any).handler ?? generateUploadUrl;
    await expect(handler(ctx, {})).rejects.toThrow(
      "User must be authenticated"
    );
  });

  test("returns upload url", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
    } as any;

    const handler = (generateUploadUrl as any).handler ?? generateUploadUrl;
    const result = await handler(ctx, {
      fileName: "file.png",
      fileType: "image/png",
    });
    expect(result).toEqual({
      key: "users/2u4/cards/pending/file/upload-key",
      url: "https://upload",
    });
  });
});
