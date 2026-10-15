import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { withTestSession } from "../helpers/session.test-utils";

// No `storage/r2` mock: the handlers resolve URLs through the unmocked
// `storage/fileUrls` leaf, so these tests exercise the real signing and
// namespace behavior. Env vars are set per test below.

const FILES_BASE = "https://files.example.com";
const SIGNING_SECRET = "test-secret-for-urls";

describe("card/getFileUrl.ts", () => {
  let getFileUrl: any;
  const previousEnv = {
    FILES_BASE: process.env.FILES_BASE,
    FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
  };

  beforeEach(async () => {
    process.env.FILES_BASE = FILES_BASE;
    process.env.FILES_SIGNING_SECRET = SIGNING_SECRET;
    getFileUrl = (await import("../../card/getFileUrl")).getFileUrl;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  test("throws when unauthenticated", async () => {
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any);
    const handler = (getFileUrl as any).handler ?? getFileUrl;
    await expect(handler(ctx, { key: "f1", cardId: "c1" })).rejects.toThrow(
      "Unauthenticated call to getFileUrl"
    );
  });

  test("returns file url for matching fileKey", async () => {
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          fileKey: "users/u1/cards/c1/file/payload.html",
          fileMetadata: { fileName: "payload.html" },
        }),
      },
    } as any);

    const handler = (getFileUrl as any).handler ?? getFileUrl;
    const result = await handler(ctx, {
      key: "users/u1/cards/c1/file/payload.html",
      cardId: "c1",
    });
    expect(result).toContain(
      `${FILES_BASE}/users/u1/cards/c1/file/payload.html`
    );
  });

  test("returns null for out-of-namespace keys", async () => {
    process.env.R2_KEY_PREFIX = "dev/";
    try {
      const ctx = withTestSession({
        auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
        db: {
          get: mock().mockResolvedValue({
            _id: "c1",
            userId: "u1",
            fileKey: "users/u1/cards/c1/file/stale.png",
            fileMetadata: { fileName: "stale.png" },
          }),
        },
      } as any);

      const handler = (getFileUrl as any).handler ?? getFileUrl;
      const result = await handler(ctx, {
        key: "users/u1/cards/c1/file/stale.png",
        cardId: "c1",
      });
      expect(result).toBeNull();
    } finally {
      delete process.env.R2_KEY_PREFIX;
    }
  });

  test("refreshes an authorized image rendition", async () => {
    const refreshCardMediaUrl = (await import("../../card/getFileUrl"))
      .refreshCardMediaUrl;
    const handler = (refreshCardMediaUrl as any).handler ?? refreshCardMediaUrl;
    const ctx = {
      runQuery: mock().mockResolvedValue({ fileName: null }),
    } as any;

    const result = await handler(ctx, {
      cardId: "c1",
      key: "users/u1/cards/c1/file/photo.png",
      rendition: "grid",
    });
    expect(result.url).toContain(
      `/__images/v1/grid/${encodeURIComponent("users/u1/cards/c1/file/photo.png")}`
    );
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
    const { attachGridFileUrls } = await import("../../card/queryUtils");
    const [card] = await attachGridFileUrls({} as any, [
      {
        _id: "c-grid",
        _creationTime: 1,
        userId: "u1",
        type: "image",
        fileKey: "users/u1/cards/c-grid/file/grid.png",
        content: "Grid image",
        isDeleted: undefined,
        createdAt: 1,
        updatedAt: 1,
      } as any,
    ]);

    expect(card?.fileUrl).toBeUndefined();
    expect(card?.detailUrl).toBeUndefined();
    expect(card?.placeholderUrl).toBeUndefined();
    const encodedKey = encodeURIComponent(
      "users/u1/cards/c-grid/file/grid.png"
    );
    expect(card?.compactUrl).toContain(`/__images/v1/compact/${encodedKey}`);
    expect(card?.thumbnailUrl).toContain(`/__images/v1/grid/${encodedKey}`);
  });
});

describe("video scrub sprites", () => {
  const video = {
    _id: "c-video",
    _creationTime: 1,
    userId: "u1",
    type: "video",
    fileKey: "users/u1/cards/c-video/file/clip.webm",
    scrubKey: "users/u1/cards/c-video/scrub/strip.jpg",
    content: "",
    createdAt: 1,
    updatedAt: 1,
  };

  test("grid cards get the whole sprite, not a resized rendition", async () => {
    process.env.FILES_BASE = FILES_BASE;
    process.env.FILES_SIGNING_SECRET = SIGNING_SECRET;
    const { attachGridFileUrls } = await import("../../card/queryUtils");
    const [card] = await attachGridFileUrls({} as any, [
      {
        ...video,
        fileMetadata: {
          scrub: { frameHeight: 180, frameWidth: 320, frames: 10 },
        },
      } as any,
    ]);

    expect(card?.scrubUrl).toContain(
      `/${encodeURIComponent(video.scrubKey).replaceAll("%2F", "/")}`
    );
    expect(card?.scrubUrl).not.toContain("/__images/v1/");
  });

  test("a sprite without its recorded size gets no URL", async () => {
    const { attachGridFileUrls } = await import("../../card/queryUtils");
    const [card] = await attachGridFileUrls({} as any, [video as any]);

    expect(card?.scrubUrl).toBeUndefined();
  });

  test("the sprite's URL can be refreshed by its owner", async () => {
    const { getAuthorizedMedia } = await import("../../card/getFileUrl");
    const handler = (getAuthorizedMedia as any).handler ?? getAuthorizedMedia;
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: { get: mock().mockResolvedValue(video) },
    } as any);

    expect(
      await handler(ctx, { cardId: "c-video", key: video.scrubKey })
    ).toEqual({ fileName: null });
  });
});

describe("getFileUrl authorization", () => {
  test("rejects a card owned by another user", async () => {
    const { getFileUrl } = await import("../../card/getFileUrl");
    const handler = (getFileUrl as any).handler ?? getFileUrl;
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u2",
          fileKey: "users/u2/cards/c1/file",
        }),
      },
    } as any);

    await expect(
      handler(ctx, { cardId: "c1", key: "users/u2/cards/c1/file" })
    ).rejects.toThrow("Unauthorized access to file");
  });

  test("rejects a key that the owned card does not reference", async () => {
    const { getFileUrl } = await import("../../card/getFileUrl");
    const handler = (getFileUrl as any).handler ?? getFileUrl;
    const ctx = withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          fileKey: "users/u1/cards/c1/file",
        }),
      },
    } as any);

    await expect(
      handler(ctx, { cardId: "c1", key: "users/u1/cards/c2/file" })
    ).rejects.toThrow("File does not belong to the specified card");
  });
});

describe("card/getFileUrl.ts getFileDownloadUrl", () => {
  const previousEnv = {
    FILES_BASE: process.env.FILES_BASE,
    FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET,
  };
  let handler: any;

  beforeEach(async () => {
    process.env.FILES_BASE = FILES_BASE;
    process.env.FILES_SIGNING_SECRET = SIGNING_SECRET;
    const { getFileDownloadUrl } = await import("../../card/getFileUrl");
    handler = (getFileDownloadUrl as any).handler ?? getFileDownloadUrl;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  const ctxWithCard = (card: unknown) =>
    withTestSession({
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: { get: mock().mockResolvedValue(card) },
    } as any);

  test("signs an attachment that keeps the file's original name", async () => {
    const url = new URL(
      await handler(
        ctxWithCard({
          _id: "c1",
          userId: "u1",
          fileKey: "users/u1/cards/c1/file/photo.png",
          fileMetadata: { fileName: "Trip photo (1).png" },
        }),
        { cardId: "c1" }
      )
    );
    expect(url.origin).toBe(FILES_BASE);
    expect(url.searchParams.get("cd")).toBe(
      "attachment; filename*=UTF-8''Trip%20photo%20%281%29.png"
    );
    expect(url.searchParams.get("ct")).toBe("image/png");
  });

  test("refuses another user's card", async () => {
    await expect(
      handler(
        ctxWithCard({
          _id: "c1",
          userId: "someone-else",
          fileKey: "users/x/cards/c1/file/a.pdf",
          fileMetadata: { fileName: "a.pdf" },
        }),
        { cardId: "c1" }
      )
    ).rejects.toThrow("Card not found");
  });

  test("returns null for a card without a file", async () => {
    expect(
      await handler(ctxWithCard({ _id: "c1", userId: "u1" }), { cardId: "c1" })
    ).toBeNull();
  });
});
