import { describe, expect, mock, test } from "bun:test";

describe("getFileUrl authorization", () => {
  test("rejects a card owned by another user", async () => {
    const { getFileUrl } = await import("../../card/getFileUrl");
    const handler = (getFileUrl as any).handler ?? getFileUrl;
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u2",
          fileKey: "users/u2/cards/c1/file",
        }),
      },
    } as any;

    await expect(
      handler(ctx, { cardId: "c1", key: "users/u2/cards/c1/file" })
    ).rejects.toThrow("Unauthorized access to file");
  });

  test("rejects a key that the owned card does not reference", async () => {
    const { getFileUrl } = await import("../../card/getFileUrl");
    const handler = (getFileUrl as any).handler ?? getFileUrl;
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          fileKey: "users/u1/cards/c1/file",
        }),
      },
    } as any;

    await expect(
      handler(ctx, { cardId: "c1", key: "users/u1/cards/c2/file" })
    ).rejects.toThrow("File does not belong to the specified card");
  });
});
