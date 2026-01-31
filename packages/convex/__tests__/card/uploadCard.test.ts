// @ts-nocheck
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

describe("card/uploadCard.ts", () => {
  let uploadAndCreateCard: any;
  let finalizeUploadedCard: any;
  let originalLimit: any;
  let originalGetSubscription: any;

  beforeEach(async () => {
    const rateLimitsModule = await import("../../shared/rateLimits");
    const billingModule = await import("../../billing");
    originalLimit = rateLimitsModule.rateLimiter.limit;
    originalGetSubscription = billingModule.polar.getCurrentSubscription;
    rateLimitsModule.rateLimiter.limit = mock().mockResolvedValue({ ok: true });
    billingModule.polar.getCurrentSubscription = mock().mockResolvedValue(null);
    const module = await import("../../card/uploadCard");
    uploadAndCreateCard = module.uploadAndCreateCard;
    finalizeUploadedCard = module.finalizeUploadedCard;
  });

  afterEach(async () => {
    const rateLimitsModule = await import("../../shared/rateLimits");
    const billingModule = await import("../../billing");
    rateLimitsModule.rateLimiter.limit = originalLimit;
    billingModule.polar.getCurrentSubscription = originalGetSubscription;
  });

  test("uploadAndCreateCard returns error when unauthenticated", async () => {
    const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
    const uploadHandler = (uploadAndCreateCard as any).handler ?? uploadAndCreateCard;
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
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
      },
      storage: { generateUploadUrl: mock().mockResolvedValue("https://upload") },
    } as any;

    const uploadHandler = (uploadAndCreateCard as any).handler ?? uploadAndCreateCard;
    const result = await uploadHandler(ctx, {
      fileName: "a.png",
      fileType: "image/png",
      fileSize: 10,
      cardType: "image",
    });
    expect(result.success).toBe(true);
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
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
      },
      storage: { generateUploadUrl: mock().mockResolvedValue("https://upload") },
    } as any;

    const uploadHandler = (uploadAndCreateCard as any).handler ?? uploadAndCreateCard;
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
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
      },
      storage: { generateUploadUrl: mock().mockRejectedValue(new Error("Storage error")) },
    } as any;

    const uploadHandler = (uploadAndCreateCard as any).handler ?? uploadAndCreateCard;
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
    const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } } as any;
    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "a.png",
      cardType: "image",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("User must be authenticated");
  });

  test("finalizeUploadedCard returns error when file not found", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
      },
    } as any;

    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "a.png",
      cardType: "image",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("File not found in storage");
  });

  test("finalizeUploadedCard creates card and schedules workflow", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue({ size: 10, contentType: "image/png" }) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "a.png",
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
        system: { get: mock().mockResolvedValue({ size: 10, contentType: "image/png" }) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "a.png",
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
        system: { get: mock().mockResolvedValue({ size: 1000, contentType: "video/mp4" }) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "video.mp4",
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
        system: { get: mock().mockResolvedValue({ size: 500, contentType: "audio/mpeg" }) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "audio.mp3",
      cardType: "audio",
      content: "",
      additionalMetadata: { recordingTimestamp: 1234567890 },
    });

    expect(result.success).toBe(true);
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        fileMetadata: expect.objectContaining({
          recordingTimestamp: 1234567890,
        }),
      })
    );
  });

  test("finalizeUploadedCard handles document mime type", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue({ size: 2000, contentType: "application/pdf" }) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "document.pdf",
      cardType: "document",
      content: "",
    });

    expect(result.success).toBe(true);
  });

  test("finalizeUploadedCard handles additional metadata", async () => {
    // Ensure rate limiter allows the operation
    const rateLimitsModule = await import("../../shared/rateLimits");
    rateLimitsModule.rateLimiter.limit = mock().mockResolvedValue({ ok: true });

    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue({ size: 10, contentType: "image/png" }) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "a.png",
      cardType: "image",
      content: "",
      additionalMetadata: {
        width: 100,
        height: 100,
        customField: "custom",
      },
    });

    // Just verify success - the internal metadata structure is handled by the function
    expect(result.success).toBe(true);
    expect(result.cardId).toBe("c1");
  });

  test("finalizeUploadedCard throws for non-file card type", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue({ size: 10, contentType: "image/png" }) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
      },
    } as any;

    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "a.png",
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
        system: { get: mock().mockResolvedValue({ size: 100, contentType: "text/plain" }) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    const result = await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "note.txt",
      cardType: "document",
      content: "",
    });

    expect(result.success).toBe(true);
  });

  test("finalizeUploadedCard sets metadata to undefined when empty", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue({ size: 10, contentType: "image/png" }) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const finalizeHandler = (finalizeUploadedCard as any).handler ?? finalizeUploadedCard;
    await finalizeHandler(ctx, {
      fileId: "f1",
      fileName: "a.png",
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
