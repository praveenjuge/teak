// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

describe("card/generateUploadUrl.ts", () => {
  let generateUploadUrl: any;

  beforeEach(async () => {
    generateUploadUrl = (await import("../../card/generateUploadUrl")).generateUploadUrl;
  });

  test("throws when unauthenticated", async () => {
    const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
    const handler = (generateUploadUrl as any).handler ?? generateUploadUrl;
    await expect(handler(ctx, {})).rejects.toThrow(
      "User must be authenticated"
    );
  });

  test("returns upload url", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      storage: { generateUploadUrl: mock().mockResolvedValue("https://upload") },
    } as any;

    const handler = (generateUploadUrl as any).handler ?? generateUploadUrl;
    const result = await handler(ctx, {
      fileName: "file.png",
      fileType: "image/png",
    });
    expect(result).toBe("https://upload");
  });
});
