// @ts-nocheck

// Set environment variables BEFORE any imports that might load auth.ts
process.env.SITE_URL = "https://teakvault.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.APPLE_CLIENT_ID = "test-apple-client-id";
process.env.APPLE_CLIENT_SECRET = "test-apple-client-secret";

import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

describe("card/createCard.ts", () => {
  let createCard: any;
  let workflow: any;
  let originalLimit: any;
  let originalGetSubscription: any;

  beforeEach(async () => {
    const managerModule = await import("../../workflows/manager");
    workflow = managerModule.workflow;
    workflow.start = mock().mockResolvedValue(undefined);

    const authModule = await import("../../auth");
    const rateLimitsModule = await import("../../shared/rateLimits");
    const billingModule = await import("../../billing");

    originalLimit = rateLimitsModule.rateLimiter.limit;
    originalGetSubscription = billingModule.polar.getCurrentSubscription;

    rateLimitsModule.rateLimiter.limit = mock().mockResolvedValue({ ok: true });
    billingModule.polar.getCurrentSubscription = mock().mockResolvedValue(null);

    createCard = (await import("../../card/createCard")).createCard;
  });

  afterEach(async () => {
    const rateLimitsModule = await import("../../shared/rateLimits");
    const billingModule = await import("../../billing");
    rateLimitsModule.rateLimiter.limit = originalLimit;
    billingModule.polar.getCurrentSubscription = originalGetSubscription;
  });

  test("throws when unauthenticated", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any;

    await expect(
      ((createCard as any).handler ?? createCard)(ctx, { content: "Hello" })
    ).rejects.toThrow("User must be authenticated");
  });

  test("creates quote card when content is quoted", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({ withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }) }),
        insert: mock().mockResolvedValue("c1"),
      },
    } as any;

    const handler = (createCard as any).handler ?? createCard;
    const cardId = await handler(ctx, {
      content: "\"Hello world\"",
    });

    expect(cardId).toBe("c1");
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        type: "quote",
        content: "Hello world",
        userId: "u1",
      })
    );
    expect(workflow.start).toHaveBeenCalled();
  });

  test("sets metadataStatus pending for link cards", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({ withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }) }),
        insert: mock().mockResolvedValue("c2"),
      },
    } as any;

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "https://example.com",
      type: "link",
      url: "https://example.com",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        type: "link",
        metadataStatus: "pending",
        url: "https://example.com",
      })
    );
  });

  test("builds fileMetadata when fileId provided", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: {
          get: mock().mockResolvedValue({ size: 123, contentType: "image/png" }),
        },
        query: mock().mockReturnValue({ withIndex: mock().mockReturnValue({ collect: mock().mockResolvedValue([]) }) }),
        insert: mock().mockResolvedValue("c3"),
      },
    } as any;

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "Image",
      fileId: "file_1",
      metadata: { fileName: "photo.png" },
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        fileMetadata: expect.objectContaining({
          fileName: "photo.png",
          fileSize: 123,
          mimeType: "image/png",
        }),
      })
    );
  });
});
