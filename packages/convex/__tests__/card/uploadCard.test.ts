// @ts-nocheck
process.env.SITE_URL = "https://teakvault.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.APPLE_CLIENT_ID = "test-apple-client-id";
process.env.APPLE_KEY_ID = "test-apple-key-id";
process.env.APPLE_PRIVATE_KEY = TEST_APPLE_PRIVATE_KEY;
process.env.APPLE_TEAM_ID = "test-apple-team-id";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { TEST_APPLE_PRIVATE_KEY } from "../helpers/appleAuth.test-utils";

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

  test("retries incomplete storage metadata across the readiness window", async () => {
    const wait = mock().mockResolvedValue(undefined);
    const send = mock()
      .mockResolvedValueOnce({ ContentLength: 10 })
      .mockResolvedValueOnce({ ContentLength: 10 })
      .mockResolvedValueOnce({ ContentLength: 10 })
      .mockResolvedValueOnce({ ContentLength: 10 })
      .mockResolvedValueOnce({
        ContentLength: 10,
        ContentType: "image/png",
        ETag: '"etag"',
      });

    await expect(
      inspectUploadedCardSource(
        "u1",
        {
          cardType: "image",
          fileKey: VALID_FILE_KEY,
          fileName: "image.png",
          fileSize: 10,
          fileType: "image/png",
        },
        { bucket: "test", client: { send }, wait }
      )
    ).resolves.toMatchObject({
      cardType: "image",
      storedFileSize: 10,
      storedMimeType: "image/png",
    });
    expect(send).toHaveBeenCalledTimes(5);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([
      100, 300, 900, 2700,
    ]);
  });

  test("keeps a stable error after incomplete storage metadata retries", async () => {
    const send = mock().mockResolvedValue({ ContentLength: 10 });
    const wait = mock().mockResolvedValue(undefined);

    await expect(
      inspectUploadedCardSource(
        "u1",
        {
          cardType: "image",
          fileKey: VALID_FILE_KEY,
          fileName: "image.png",
          fileSize: 10,
          fileType: "image/png",
        },
        { bucket: "test", client: { send }, wait }
      )
    ).rejects.toMatchObject({
      data: {
        code: "INVALID_INPUT",
        message: "Uploaded file metadata is unavailable",
      },
    });
    expect(send).toHaveBeenCalledTimes(6);
    expect(wait).toHaveBeenCalledTimes(4);
  });

  test("uses a bounded GET probe when HEAD omits the object ETag", async () => {
    const transformToByteArray = mock().mockResolvedValue(new Uint8Array([1]));
    const send = mock(async (command) =>
      command.constructor.name === "GetObjectCommand"
        ? {
            Body: { transformToByteArray },
            ContentType: "image/svg+xml",
            ETag: '"etag"',
          }
        : {
            ContentLength: 10,
            ContentType: "image/svg+xml",
          }
    );
    const wait = mock().mockResolvedValue(undefined);

    await expect(
      inspectUploadedCardSource(
        "u1",
        {
          cardType: "image",
          fileKey: VALID_FILE_KEY,
          fileName: "icon.svg",
          fileSize: 10,
          fileType: "image/svg+xml",
        },
        { bucket: "test", client: { send }, wait }
      )
    ).resolves.toMatchObject({
      cardType: "image",
      storedFileSize: 10,
      storedMimeType: "image/svg+xml",
    });
    expect(send).toHaveBeenCalledTimes(6);
    expect(transformToByteArray).toHaveBeenCalledTimes(1);
  });

  test("verifies an upload-response ETag when storage responses omit it", async () => {
    const bytes = new TextEncoder().encode("# exact");
    const commands: Array<{ input?: { IfMatch?: string } }> = [];
    const send = mock((command) => {
      commands.push(command);
      if (command.constructor.name === "GetObjectCommand") {
        return { Body: { transformToByteArray: async () => bytes } };
      }
      return {
        ContentLength: bytes.byteLength,
        ContentType: "text/markdown",
      };
    });

    await expect(
      inspectUploadedCardSource(
        "u1",
        {
          fileEtag: '"upload-etag"',
          fileKey: VALID_FILE_KEY,
          fileName: "README.md",
          fileSize: bytes.byteLength,
          fileType: "text/markdown",
        },
        { bucket: "test", client: { send } }
      )
    ).resolves.toMatchObject({
      cardType: "text",
      content: "# exact",
      storedFileSize: bytes.byteLength,
    });
    expect(commands).toHaveLength(3);
    expect(
      commands.every((command) => command.input?.IfMatch === '"upload-etag"')
    ).toBe(true);
  });

  test("uses successful conditional reads instead of response ETag formatting", async () => {
    const bytes = new TextEncoder().encode("# exact");
    const commands: Array<{ input?: { IfMatch?: string } }> = [];
    const send = mock((command) => {
      commands.push(command);
      if (command.constructor.name === "GetObjectCommand") {
        return {
          Body: { transformToByteArray: async () => bytes },
          ETag: '"storage-formatted-etag"',
        };
      }
      return {
        ContentLength: bytes.byteLength,
        ContentType: "text/markdown",
        ETag: '"storage-formatted-etag"',
      };
    });

    await expect(
      inspectUploadedCardSource(
        "u1",
        {
          fileEtag: '"upload-response-etag"',
          fileKey: VALID_FILE_KEY,
          fileName: "README.md",
          fileSize: bytes.byteLength,
          fileType: "text/markdown",
        },
        { bucket: "test", client: { send } }
      )
    ).resolves.toMatchObject({
      cardType: "text",
      content: "# exact",
      storedFileSize: bytes.byteLength,
    });
    expect(commands).toHaveLength(3);
    expect(
      commands.every(
        (command) => command.input?.IfMatch === '"upload-response-etag"'
      )
    ).toBe(true);
  });

  test("derives verified size from a bounded range response", async () => {
    const commands: Array<{ input?: { IfMatch?: string; Range?: string } }> =
      [];
    const send = mock((command) => {
      commands.push(command);
      if (command.constructor.name === "GetObjectCommand") {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array([60]),
          },
          ContentRange: "bytes 0-0/16467",
          ContentType: "image/svg+xml",
        };
      }
      return {};
    });
    const wait = mock().mockResolvedValue(undefined);

    await expect(
      inspectUploadedCardSource(
        "u1",
        {
          cardType: "image",
          fileEtag: '"upload-etag"',
          fileKey: VALID_FILE_KEY,
          fileName: "icon.svg",
          fileSize: 16_467,
          fileType: "image/svg+xml",
        },
        { bucket: "test", client: { send }, wait }
      )
    ).resolves.toMatchObject({
      cardType: "image",
      storedFileSize: 16_467,
      storedMimeType: "image/svg+xml",
    });
    expect(commands).toHaveLength(6);
    expect(commands.at(-1)?.input).toMatchObject({
      IfMatch: '"upload-etag"',
      Range: "bytes=0-0",
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
    const wait = mock().mockResolvedValue(undefined);
    const send = mock(() => {
      call += 1;
      if (call === 2) {
        return {
          Body: { transformToByteArray: async () => bytes },
          ETag: '"etag-1"',
        };
      }
      if (call > 2) {
        throw new Error("PreconditionFailed");
      }
      return {
        ContentLength: bytes.byteLength,
        ETag: '"etag-1"',
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
        { bucket: "test", client: { send }, wait }
      )
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    expect(wait).toHaveBeenCalledTimes(4);
  });

  test("retries incomplete verification metadata after reading Markdown", async () => {
    const bytes = new TextEncoder().encode("# stable");
    const wait = mock().mockResolvedValue(undefined);
    let call = 0;
    const send = mock((command) => {
      call += 1;
      if (command.constructor.name === "GetObjectCommand") {
        return {
          Body: { transformToByteArray: async () => bytes },
          ETag: '"etag"',
        };
      }
      if (call === 3) {
        return { ETag: '"etag"' };
      }
      return {
        ContentLength: bytes.byteLength,
        ContentType: "text/markdown",
        ETag: '"etag"',
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
        { bucket: "test", client: { send }, wait }
      )
    ).resolves.toMatchObject({
      cardType: "text",
      content: "# stable",
      storedFileSize: bytes.byteLength,
    });
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(100);
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
