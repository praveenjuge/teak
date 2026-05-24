// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

const resolveObjectUrlMock = mock((key?: string) =>
  Promise.resolve(key ? "https://file" : null)
);

mock.module("../../storage/r2", () => ({
  deleteObject: mock(() => Promise.resolve()),
  resolveObjectUrl: resolveObjectUrlMock,
}));

describe("card/getFileUrl.ts", () => {
  let getFileUrl: any;

  beforeEach(async () => {
    getFileUrl = (await import("../../card/getFileUrl")).getFileUrl;
  });

  test("throws when unauthenticated", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any;
    const handler = (getFileUrl as any).handler ?? getFileUrl;
    await expect(handler(ctx, { key: "f1", cardId: "c1" })).rejects.toThrow(
      "Unauthenticated call to getFileUrl"
    );
  });

  test("returns file url for matching fileKey", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          fileKey: "f1",
        }),
      },
    } as any;

    const handler = (getFileUrl as any).handler ?? getFileUrl;
    const result = await handler(ctx, { key: "f1", cardId: "c1" });
    expect(result).toBe("https://file");
  });
});
