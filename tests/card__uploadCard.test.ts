// @ts-nocheck
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

describe("card/uploadCard.ts", () => {
  let uploadAndCreateCard: any;
  let finalizeUploadedCard: any;
  let originalLimit: any;
  let originalGetSubscription: any;

  beforeEach(async () => {
    const rateLimitsModule = await import("../convex/shared/rateLimits");
    const billingModule = await import("../convex/billing");
    originalLimit = rateLimitsModule.rateLimiter.limit;
    originalGetSubscription = billingModule.polar.getCurrentSubscription;
    rateLimitsModule.rateLimiter.limit = mock().mockResolvedValue({ ok: true });
    billingModule.polar.getCurrentSubscription = mock().mockResolvedValue(null);
    const module = await import("../convex/card/uploadCard");
    uploadAndCreateCard = module.uploadAndCreateCard;
    finalizeUploadedCard = module.finalizeUploadedCard;
  });

  afterEach(async () => {
    const rateLimitsModule = await import("../convex/shared/rateLimits");
    const billingModule = await import("../convex/billing");
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
});
