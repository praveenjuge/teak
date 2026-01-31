// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

describe("card/deleteCard.ts", () => {
  let permanentDeleteCard: any;

  beforeEach(async () => {
    permanentDeleteCard = (await import("../../card/deleteCard")).permanentDeleteCard;
  });

  test("throws when unauthenticated", async () => {
    const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
    const handler = (permanentDeleteCard as any).handler ?? permanentDeleteCard;
    await expect(handler(ctx, { id: "c1" })).rejects.toThrow(
      "User must be authenticated"
    );
  });

  test("deletes files and card", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          fileId: "f1",
          thumbnailId: "t1",
        }),
        delete: mock().mockResolvedValue(null),
      },
      storage: { delete: mock().mockResolvedValue(null) },
    } as any;

    const handler = (permanentDeleteCard as any).handler ?? permanentDeleteCard;
    await handler(ctx, { id: "c1" });
    expect(ctx.storage.delete).toHaveBeenCalledWith("f1");
    expect(ctx.storage.delete).toHaveBeenCalledWith("t1");
    expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c1");
  });
});
