// @ts-nocheck
process.env.SITE_URL = "https://teakvault.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.APPLE_CLIENT_ID = "test-apple-client-id";
process.env.APPLE_CLIENT_SECRET = "test-apple-client-secret";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const VALID_FILE_KEY = "users/2u4/cards/pending/file/upload-key";

describe("card/uploadCard.ts", () => {
  let uploadAndCreateCard: any;
  let finalizeUploadedCard: any;
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
    finalizeUploadedCard = module.finalizeUploadedCard;
  });

  afterEach(async () => {
    const rateLimitsModule = await import("../../shared/rateLimits");
    const billingModule = await import("../../billing");
    rateLimitsModule.rateLimiter.limit = originalLimit;
    billingModule.polar.getCurrentSubscription = originalGetSubscription;
    r2Module.r2.generateUploadUrl = originalGenerateUploadUrl;
  });

  test("uploadAndCreateCard returns error when unauthenticated", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any;
    const uploadHandler =
      (uploadAndCreateCard as any).handler ?? uploadAndCreateCard;
    const result = await uploadHandler(ctx, {
      fileName: "a.png",
      fileType: "image/png",
      fileSize: 10,
      cardType: "image",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("User must be authenticated");
  });

  test("uploadAndCreateCard returns upload url", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
      },
      storage: {
        generateUploadUrl: mock().mockResolvedValue("https://upload"),
      },
    } as any;

    const uploadHandler =
      (uploadAndCreateCard as any).handler ?? uploadAndCreateCard;
    const result = await uploadHandler(ctx, {
      fileName: "a.png",
      fileType: "image/png",
      fileSize: 10,
      cardType: "image",
    });
    expect(result.success).toBe(true);
    expect(result.uploadKey).toBe(VALID_FILE_KEY);
    expect(result.uploadUrl).toBe("https://upload");
  });

  test("uploadAndCreateCard returns error with code when rate limit exceeded", async () => {
    const rateLimitsModule = await import("../../shared/rateLimits");
    rateLimitsModule.rateLimiter.limit = mock().mockResolvedValue({
      ok: false,
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });

    // Re-import to get updated mocks
    const module = await import("../../card/uploadCard");
    uploadAndCreateCard = module.uploadAndCreateCard;

    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
      },
      storage: {
        generateUploadUrl: mock().mockResolvedValue("https://upload"),
      },
    } as any;

    const uploadHandler =
      (uploadAndCreateCard as any).handler ?? uploadAndCreateCard;
    const result = await uploadHandler(ctx, {
      fileName: "a.png",
      fileType: "image/png",
      fileSize: 10,
      cardType: "image",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("RATE_LIMITED");
  });

  test("uploadAndCreateCard handles generic errors", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
      },
    } as any;
    r2Module.r2.generateUploadUrl = mock().mockRejectedValue(
      new Error("Storage error")
    );

    const uploadHandler =
      (uploadAndCreateCard as any).handler ?? uploadAndCreateCard;
    const result = await uploadHandler(ctx, {
      fileName: "a.png",
      fileType: "image/png",
      fileSize: 10,
      cardType: "image",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Storage error");
  });

  test("finalizeUploadedCard returns error when unauthenticated", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any;
    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "a.png",
      cardType: "image",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("User must be authenticated");
  });

  test("finalizeUploadedCard rejects keys outside the user's prefix", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: "users/other/cards/pending/file/upload-key",
      fileName: "a.png",
      cardType: "image",
      fileType: "image/png",
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("INVALID_STORAGE_KEY");
    const telemetryArgs = ctx.scheduler.runAfter.mock.calls.map(
      (call: unknown[]) => call[2]
    );
    expect(telemetryArgs).toHaveLength(2);
    for (const args of telemetryArgs) {
      expect(args).toEqual(
        expect.objectContaining({
          errorClass: "ValidationError",
          outcome: "failure",
        })
      );
    }
  });

  test("finalizeUploadedCard creates card and schedules workflow", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "a.png",
      fileSize: 10,
      fileType: "image/png",
      cardType: "image",
      content: "",
      additionalMetadata: { width: 100, height: 100 },
    });

    expect(result.success).toBe(true);
    expect(result.cardId).toBe("c1");
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        fileMetadata: expect.objectContaining({
          fileName: "a.png",
          width: 100,
          height: 100,
        }),
      })
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalled();
  });

  test("finalizeUploadedCard returns type mismatch", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "a.png",
      fileSize: 10,
      fileType: "image/png",
      cardType: "audio",
      content: "",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("TYPE_MISMATCH");
  });

  test("finalizeUploadedCard handles video mime type", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "video.mp4",
      fileSize: 1000,
      fileType: "video/mp4",
      cardType: "video",
      content: "",
      additionalMetadata: { duration: 30 },
    });

    expect(result.success).toBe(true);
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        fileMetadata: expect.objectContaining({
          duration: 30,
        }),
      })
    );
  });

  test("finalizeUploadedCard handles audio mime type", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "audio.mp3",
      fileSize: 500,
      fileType: "audio/mpeg",
      cardType: "audio",
      content: "",
      additionalMetadata: { recordingTimestamp: 1_234_567_890 },
    });

    expect(result.success).toBe(true);
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        fileMetadata: expect.objectContaining({
          recordingTimestamp: 1_234_567_890,
        }),
      })
    );
  });

  test("finalizeUploadedCard handles document mime type", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "document.pdf",
      fileSize: 2000,
      fileType: "application/pdf",
      cardType: "document",
      content: "",
    });

    expect(result.success).toBe(true);
  });

  test("finalizeUploadedCard infers file card type and compact metadata", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "component.tsx",
      fileSize: 2000,
      fileType: "application/octet-stream",
      content: "",
    });

    expect(result).toMatchObject({ success: true, cardId: "c1" });
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        type: "document",
        fileMetadata: expect.objectContaining({
          extension: "tsx",
          kind: "source",
          language: "tsx",
          mimeType: "text/tsx",
        }),
      })
    );
  });

  test("finalizeUploadedCard infers GIF uploads as video-like motion", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;
    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;

    await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "motion.gif",
      fileSize: 99,
      fileType: "image/gif",
    });

    expect(ctx.db.insert.mock.calls[0]?.[1]).toMatchObject({
      type: "video",
      fileMetadata: {
        extension: "gif",
        fileName: "motion.gif",
        fileSize: 99,
        kind: "motion",
        mimeType: "image/gif",
        preview: { animated: true },
      },
    });
  });

  test("finalizeUploadedCard handles additional metadata", async () => {
    // Ensure rate limiter allows the operation
    const rateLimitsModule = await import("../../shared/rateLimits");
    rateLimitsModule.rateLimiter.limit = mock().mockResolvedValue({ ok: true });

    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "a.png",
      fileSize: 10,
      fileType: "image/png",
      cardType: "image",
      content: "",
      additionalMetadata: {
        width: 100,
        height: 100,
        customField: "custom",
        extractedText: "must never be persisted",
      },
    });

    // Just verify success - the internal metadata structure is handled by the function
    expect(result.success).toBe(true);
    expect(result.cardId).toBe("c1");
    const insertedCard = ctx.db.insert.mock.calls[0]?.[1];
    expect(insertedCard.metadata).toBeUndefined();
    expect(JSON.stringify(insertedCard.fileMetadata)).not.toContain(
      "must never be persisted"
    );
  });

  test("finalizeUploadedCard throws for non-file card type", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
      },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "a.png",
      fileSize: 10,
      fileType: "image/png",
      cardType: "link" as any,
      content: "",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("TYPE_MISMATCH");
  });

  test("finalizeUploadedCard handles text document mime type", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "note.txt",
      fileSize: 100,
      fileType: "text/plain",
      cardType: "document",
      content: "",
    });

    expect(result.success).toBe(true);
  });

  test("finalizeUploadedCard sets metadata to undefined when empty", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler =
      (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    await finalizeHandler(ctx, {
      fileKey: VALID_FILE_KEY,
      fileName: "a.png",
      fileSize: 10,
      fileType: "image/png",
      cardType: "image",
      content: "",
      additionalMetadata: {},
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        metadata: undefined,
      })
    );
  });
});
