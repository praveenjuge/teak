// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

describe("card/getFileUrl.ts", () => {
  let getFileUrl: any;

  beforeEach(async () => {
    getFileUrl = (await import("../../../convex/card/getFileUrl")).getFileUrl;
  });

  test("throws when unauthenticated", async () => {
    const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
    const handler = (getFileUrl as any).handler ?? getFileUrl;
    await expect(handler(ctx, { fileId: "f1", cardId: "c1" })).rejects.toThrow(
      "Unauthenticated call to getFileUrl"
    );
  });

  test("returns file url for matching fileId", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          fileId: "f1",
        }),
      },
      storage: { getUrl: mock().mockResolvedValue("https://file") },
    } as any;

    const handler = (getFileUrl as any).handler ?? getFileUrl;
    const result = await handler(ctx, { fileId: "f1", cardId: "c1" });
    expect(result).toBe("https://file");
  });
});
