// @ts-nocheck
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as r2Storage from "../../storage/r2";

const deleteObjectMock = spyOn(r2Storage, "deleteObject").mockResolvedValue(
  undefined
);

describe("card/deleteCard.ts", () => {
  let permanentDeleteCard: any;

  beforeEach(async () => {
    permanentDeleteCard = (await import("../../card/deleteCard"))
      .permanentDeleteCard;
  });

  test("throws when unauthenticated", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any;
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
          type: "image",
          fileKey: "f1",
          previewKey: "p1",
          thumbnailKey: "t1",
        }),
        delete: mock().mockResolvedValue(null),
        patch: mock().mockResolvedValue(null),
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            unique: mock().mockResolvedValue({
              _id: "usage_1",
              activeCardCount: 1,
              isSaturated: false,
            }),
          }),
        }),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const handler = (permanentDeleteCard as any).handler ?? permanentDeleteCard;
    await handler(ctx, { id: "c1" });
    expect(deleteObjectMock).toHaveBeenCalledWith(ctx, "f1");
    expect(deleteObjectMock).toHaveBeenCalledWith(ctx, "p1");
    expect(deleteObjectMock).toHaveBeenCalledWith(ctx, "t1");
    expect(ctx.db.delete).toHaveBeenCalledWith("cards", "c1");
  });
});
