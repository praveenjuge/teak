// @ts-nocheck
process.env.SITE_URL = "https://teakvault.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.APPLE_CLIENT_ID = "test-apple-client-id";
process.env.APPLE_CLIENT_SECRET = "test-apple-client-secret";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const VALID_FILE_KEY = "users/2u4/cards/pending/file/upload-key";

describe("card uploads", () => {
  let uploadAndCreateCard: any;
  let createUploadedCardForUser: any;
  let inspectUploadedCardSource: any;
  let validateDirectUploadRequest: any;
  let originalLimit: any;
  let originalGetSubscription: any;
  let r2Module: any;
  let originalGenerateUploadUrl: any;

  beforeEach(async () => {
    const rateLimitsModule = await import("../../shared/rateLimits");
    const billingModule = await import("../../billing");
    r2Module = await import("../../storage/r2");
    originalLimit = rateLimitsModule.rateLimiter.limit;
    originalGetSubscription = billingModule.polar.getCurrentSubscription;
    originalGenerateUploadUrl = r2Module.r2.generateUploadUrl;
    rateLimitsModule.rateLimiter.limit = mock().mockResolvedValue({ ok: true });
    billingModule.polar.getCurrentSubscription = mock().mockResolvedValue(null);
    r2Module.r2.generateUploadUrl = mock().mockResolvedValue({
      key: VALID_FILE_KEY,
      url: "https://upload",
    });
    const module = await import("../../card/uploadCard");
    uploadAndCreateCard = module.uploadAndCreateCard;
    createUploadedCardForUser = module.createUploadedCardForUser;
    validateDirectUploadRequest = module.validateDirectUploadRequest;
    inspectUploadedCardSource = (await import("../../card/uploadCardAction"))
      .inspectUploadedCardSource;
  });

  afterEach(async () => {
    const rateLimitsModule = await import("../../shared/rateLimits");
    const billingModule = await import("../../billing");
    rateLimitsModule.rateLimiter.limit = originalLimit;
    billingModule.polar.getCurrentSubscription = originalGetSubscription;
    r2Module.r2.generateUploadUrl = originalGenerateUploadUrl;
  });

  test("prepares an owned upload URL for authenticated users", async () => {
    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({ subject: "u1" }),
      },
      db: {
        query: () => ({
          withIndex: () => ({ take: mock().mockResolvedValue([]) }),
        }),
      },
    } as any;
    const handler = uploadAndCreateCard.handler ?? uploadAndCreateCard;
    const result = await handler(ctx, {
      fileName: "a.png",
      fileType: "image/png",
      fileSize: 10,
      cardType: "image",
    });
    expect(result).toMatchObject({
      success: true,
      uploadKey: VALID_FILE_KEY,
      uploadUrl: "https://upload",
    });
  });

  test("prepares Markdown at 512 KiB and rejects one byte over", () => {
    expect(
      validateDirectUploadRequest({
        fileName: "README.MD",
        fileType: "text/markdown",
        fileSize: 512 * 1024,
      })
    ).toMatchObject({ fileName: "README.MD" });
    let oversizedError: unknown;
    try {
      validateDirectUploadRequest({
        fileName: "README.MD",
        fileType: "text/markdown",
        fileSize: 512 * 1024 + 1,
      });
    } catch (error) {
      oversizedError = error;
    }
    expect(oversizedError).toMatchObject({
      data: { code: "CONTENT_TOO_LARGE" },
    });
  });

  test("allows older clients to prepare Markdown as a document", async () => {
    const handler = uploadAndCreateCard.handler ?? uploadAndCreateCard;
    const result = await handler(
      {
        auth: {
          getUserIdentity: mock().mockResolvedValue({ subject: "u1" }),
        },
        db: {
          query: () => ({
            withIndex: () => ({ take: mock().mockResolvedValue([]) }),
          }),
        },
      },
      {
        cardType: "document",
        fileName: "legacy-client.md",
        fileSize: 10,
        fileType: "text/markdown",
      }
    );
    expect(result).toMatchObject({
      success: true,
      uploadKey: VALID_FILE_KEY,
    });
  });

  test("rejects upload preparation without authentication", async () => {
    const handler = uploadAndCreateCard.handler ?? uploadAndCreateCard;
    expect(
      await handler(
        { auth: { getUserIdentity: mock().mockResolvedValue(null) } },
        {
          fileName: "a.png",
          fileType: "image/png",
          fileSize: 10,
          cardType: "image",
        }
      )
    ).toMatchObject({
      success: false,
      error: "User must be authenticated",
    });
  });

  test("creates ordinary uploaded cards with compact file metadata", async () => {
    const ctx = {
      db: {
        insert: mock().mockResolvedValue("card-1"),
        query: () => ({
          withIndex: () => ({ take: mock().mockResolvedValue([]) }),
        }),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;
    const cardId = await createUploadedCardForUser(ctx, {
      additionalMetadata: { width: 100, height: 50 },
      cardType: "image",
      content: "",
      fileKey: VALID_FILE_KEY,
      fileName: "a.png",
      fileSize: 10,
      fileType: "image/png",
      storedFileSize: 10,
      storedFileType: "image/png",
      userId: "u1",
    });
    expect(cardId).toBe("card-1");
    expect(ctx.db.insert.mock.calls[0]?.[1]).toMatchObject({
      type: "image",
      fileKey: VALID_FILE_KEY,
      fileMetadata: {
        extension: "png",
        fileName: "a.png",
        fileSize: 10,
        height: 50,
        kind: "image",
        mimeType: "image/png",
        width: 100,
      },
    });
  });

  test("creates Markdown uploads as text with exact content and provenance", async () => {
    const source = "\uFEFF  # Heading\r\n\rBody  ";
    const ctx = {
      db: {
        insert: mock().mockResolvedValue("card-1"),
        query: () => ({
          withIndex: () => ({ take: mock().mockResolvedValue([]) }),
        }),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;
    await createUploadedCardForUser(ctx, {
      cardType: "text",
      content: source,
      fileKey: VALID_FILE_KEY,
      fileName: "README.MarkDown",
      fileSize: new TextEncoder().encode(source).byteLength,
      fileType: "text/markdown",
      storedFileSize: new TextEncoder().encode(source).byteLength,
      storedFileType: "text/markdown",
      userId: "u1",
    });
    expect(ctx.db.insert.mock.calls[0]?.[1]).toMatchObject({
      type: "text",
      content: source,
      fileKey: VALID_FILE_KEY,
      fileMetadata: {
        fileName: "README.MarkDown",
        kind: "markdown",
      },
    });
  });

  test("strictly decodes Markdown objects at the exact byte limit", async () => {
    const bytes = new Uint8Array(512 * 1024).fill(97);
    const send = mock(async (command) =>
      command.constructor.name === "HeadObjectCommand"
        ? {
            ContentLength: bytes.byteLength,
            ContentType: "text/markdown",
            ETag: '"etag"',
          }
        : {
            Body: { transformToByteArray: async () => bytes },
            ETag: '"etag"',
          }
    );

    await expect(
      inspectUploadedCardSource(
        "u1",
        {
          fileKey: VALID_FILE_KEY,
          fileName: "README.MD",
          fileSize: bytes.byteLength,
          fileType: "text/markdown",
        },
        { bucket: "test", client: { send } }
      )
    ).resolves.toMatchObject({
      cardType: "text",
      content: "a".repeat(512 * 1024),
      storedFileSize: 512 * 1024,
    });
  });

  test("rejects oversized and invalid UTF-8 Markdown objects without reading partial text", async () => {
    const oversizedSend = mock(async () => ({
      ContentLength: 512 * 1024 + 1,
      ContentType: "text/markdown",
      ETag: '"etag"',
    }));
    await expect(
      inspectUploadedCardSource(
        "u1",
        {
          fileKey: VALID_FILE_KEY,
          fileName: "README.md",
          fileSize: 512 * 1024 + 1,
          fileType: "text/markdown",
        },
        { bucket: "test", client: { send: oversizedSend } }
      )
    ).rejects.toMatchObject({ data: { code: "CONTENT_TOO_LARGE" } });
    expect(oversizedSend).toHaveBeenCalledTimes(1);

    const invalid = new Uint8Array([0xc3, 0x28]);
    const invalidSend = mock(async (command) =>
      command.constructor.name === "HeadObjectCommand"
        ? {
            ContentLength: invalid.byteLength,
            ContentType: "text/markdown",
            ETag: '"etag"',
          }
        : {
            Body: { transformToByteArray: async () => invalid },
            ETag: '"etag"',
          }
    );
    await expect(
      inspectUploadedCardSource(
        "u1",
        {
          fileKey: VALID_FILE_KEY,
          fileName: "README.markdown",
          fileSize: invalid.byteLength,
          fileType: "text/markdown",
        },
        { bucket: "test", client: { send: invalidSend } }
      )
    ).rejects.toMatchObject({ data: { code: "INVALID_UTF8" } });
  });

  test("rejects Markdown objects that change after decoding", async () => {
    const bytes = new TextEncoder().encode("# stable");
    let call = 0;
    const send = mock(() => {
      call += 1;
      if (call === 2) {
        return {
          Body: { transformToByteArray: async () => bytes },
          ETag: '"etag-1"',
        };
      }
      return {
        ContentLength: bytes.byteLength,
        ETag: call === 1 ? '"etag-1"' : '"etag-2"',
      };
    });

    await expect(
      inspectUploadedCardSource(
        "u1",
        {
          fileKey: VALID_FILE_KEY,
          fileName: "README.md",
          fileSize: bytes.byteLength,
          fileType: "text/markdown",
        },
        { bucket: "test", client: { send } }
      )
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  });

  test("rejects ownership and stored metadata mismatches", async () => {
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({ take: mock().mockResolvedValue([]) }),
        }),
      },
    } as any;
    await expect(
      createUploadedCardForUser(ctx, {
        cardType: "image",
        fileKey: "users/other/cards/pending/file/a.png",
        fileName: "a.png",
        fileSize: 10,
        fileType: "image/png",
        storedFileSize: 11,
        storedFileType: "image/png",
        userId: "u1",
      })
    ).rejects.toThrow("does not belong");
    await expect(
      createUploadedCardForUser(ctx, {
        cardType: "image",
        fileKey: VALID_FILE_KEY,
        fileName: "a.png",
        fileSize: 10,
        fileType: "image/png",
        storedFileSize: 11,
        storedFileType: "image/png",
        userId: "u1",
      })
    ).rejects.toThrow("does not match");
  });
});
