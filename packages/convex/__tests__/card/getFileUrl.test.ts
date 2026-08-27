// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

const resolveObjectUrlMock = mock((key?: string) =>
  Promise.resolve(key ? "https://file" : null)
);
const resolveImageUrlMock = mock((key?: string, rendition?: string) =>
  Promise.resolve(key && rendition ? `https://file/${rendition}` : null)
);

mock.module("../../storage/r2", () => ({
  deleteObject: mock(() => Promise.resolve()),
  resolveObjectUrl: resolveObjectUrlMock,
  resolveImageUrl: resolveImageUrlMock,
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
          fileMetadata: { fileName: "payload.html" },
        }),
      },
    } as any;

    const handler = (getFileUrl as any).handler ?? getFileUrl;
    const result = await handler(ctx, { key: "f1", cardId: "c1" });
    expect(result).toBe("https://file");
    expect(resolveObjectUrlMock).toHaveBeenCalledWith("f1", "payload.html");
  });

  test("refreshes an authorized image rendition", async () => {
    const refreshCardMediaUrl = (await import("../../card/getFileUrl"))
      .refreshCardMediaUrl;
    const handler = (refreshCardMediaUrl as any).handler ?? refreshCardMediaUrl;
    const ctx = {
      runQuery: mock().mockResolvedValue({ fileName: null }),
    } as any;

    await expect(
      handler(ctx, { cardId: "c1", key: "f1", rendition: "grid" })
    ).resolves.toEqual({ url: "https://file/grid" });
    expect(resolveImageUrlMock).toHaveBeenCalledWith("f1", "grid");
  });

  test("rejects a refresh when the media is not authorized", async () => {
    const refreshCardMediaUrl = (await import("../../card/getFileUrl"))
      .refreshCardMediaUrl;
    const handler = (refreshCardMediaUrl as any).handler ?? refreshCardMediaUrl;
    const ctx = { runQuery: mock().mockResolvedValue(null) } as any;

    await expect(
      handler(ctx, { cardId: "c1", key: "not-owned", rendition: "grid" })
    ).rejects.toThrow("Unauthorized media refresh");
  });

  test("grid hydration omits original, detail, and tiny image URLs", async () => {
    resolveObjectUrlMock.mockClear();
    const { attachGridFileUrls } = await import("../../card/queryUtils");
    const [card] = await attachGridFileUrls({} as any, [
      {
        _id: "c-grid",
        _creationTime: 1,
        userId: "u1",
        type: "image",
        fileKey: "image-key",
        content: "Grid image",
        isDeleted: undefined,
        createdAt: 1,
        updatedAt: 1,
      } as any,
    ]);

    expect(card?.fileUrl).toBeUndefined();
    expect(card?.detailUrl).toBeUndefined();
    expect(card?.placeholderUrl).toBeUndefined();
    expect(card?.compactUrl).toBe("https://file/compact");
    expect(card?.thumbnailUrl).toBe("https://file/grid");
    expect(resolveObjectUrlMock).not.toHaveBeenCalled();
  });
});
