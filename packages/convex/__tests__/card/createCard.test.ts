// @ts-nocheck

// Set environment variables BEFORE any imports that might load auth.ts
process.env.SITE_URL = "https://teakvault.com";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.APPLE_CLIENT_ID = "test-apple-client-id";
process.env.APPLE_CLIENT_SECRET = "test-apple-client-secret";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

describe("card/createCard.ts", () => {
  let createCard: any;
  let workflow: any;
  let originalLimit: any;
  let originalGetSubscription: any;

  beforeEach(async () => {
    const managerModule = await import("../../workflows/manager");
    workflow = managerModule.workflow;
    workflow.start = mock().mockResolvedValue(undefined);

    const _authModule = await import("../../auth");
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

    const handler = (createCard as any).handler ?? createCard;
    const cardId = await handler(ctx, {
      content: '"Hello world"',
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
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        event: "card.created",
        cardId: "c1",
        cardType: "quote",
        surface: "unknown",
        userId: "u1",
      })
    );
  });

  test("sets metadataStatus pending for link cards", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c2"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
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

  test("upgrades to link card when content is a URL but type is explicitly text", async () => {
    // Regression: saving a URL (e.g. a Goodreads book link) was stored as a
    // "text" card whenever the client passed type: "text" explicitly, because
    // the extracted URL never upgraded the card type and async classification
    // was skipped for client-provided types.
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c_goodreads"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "https://www.goodreads.com/book/show/2767052-the-hunger-games",
      type: "text",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        type: "link",
        metadataStatus: "pending",
        url: "https://www.goodreads.com/book/show/2767052-the-hunger-games",
      })
    );
  });

  test("upgrades to link card when content is a URL and type is omitted", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c_link_auto"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "https://www.goodreads.com/book/show/2767052-the-hunger-games",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        type: "link",
        metadataStatus: "pending",
        url: "https://www.goodreads.com/book/show/2767052-the-hunger-games",
      })
    );
  });

  test("keeps text card when content has no URL", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c_text"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "just a regular note without any links",
      type: "text",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        type: "text",
        content: "just a regular note without any links",
      })
    );
  });

  test("rejects unsafe url schemes", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c_unsafe"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const handler = (createCard as any).handler ?? createCard;
    await expect(
      handler(ctx, {
        content: "click me",
        type: "link",
        url: "javascript:alert(1)",
      })
    ).rejects.toThrow("http or https");

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  test("builds fileMetadata when fileKey provided", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c3"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "Image",
      fileKey: "users/u/cards/c/file/key",
      metadata: {
        fileName: "photo.png",
        fileSize: 123,
        mimeType: "image/png",
      },
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

  test("preserves metadata source when provided", async () => {
    const ctx = {
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
          }),
        }),
        insert: mock().mockResolvedValue("c4"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "https://example.com/article",
      metadata: { source: "raycast_browser_tab" },
      type: "link",
      url: "https://example.com/article",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        metadata: expect.objectContaining({
          source: "raycast_browser_tab",
        }),
      })
    );
  });
});
