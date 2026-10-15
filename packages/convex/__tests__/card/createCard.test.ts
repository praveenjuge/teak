// @ts-nocheck

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CARD_USAGE_SHARD_VERSION } from "../../card/cardUsage";
import { buildR2UserPrefix } from "../../storage/r2";
import { withTestSession } from "../helpers/session.test-utils";

describe("card/createCard.ts", () => {
  let createCard: any;
  let workflow: any;
  let originalGetSubscription: any;

  const addCardUsage = (ctx: any) => {
    if (!ctx.db?.query) {
      return;
    }
    const query = ctx.db.query.bind(ctx.db);
    ctx.db.query = mock((table: string) => {
      if (table === "userCardUsageShards") {
        return {
          withIndex: (_name: string, callback: (builder: any) => void) => {
            const builder = { eq: () => builder };
            callback(builder);
            return {
              unique: mock().mockResolvedValue({
                _id: "usage_shard_1",
                activeCardCount: 0,
                shard: 0,
                updatedAt: 1,
                userId: "u1",
              }),
            };
          },
        };
      }
      if (table !== "userCardUsage") {
        return query(table);
      }
      return {
        withIndex: () => ({
          unique: mock().mockResolvedValue({
            _id: "usage_1",
            activeCardCount: 0,
            isCountExact: true,
            isSaturated: false,
            shardVersion: CARD_USAGE_SHARD_VERSION,
            shardedAt: 1,
          }),
        }),
      };
    });
    ctx.db.patch ??= mock().mockResolvedValue(null);
  };

  beforeEach(async () => {
    const managerModule = await import("../../workflows/manager");
    workflow = managerModule.workflow;
    workflow.start = mock().mockResolvedValue(undefined);

    const _authModule = await import("../../auth");
    const billingModule = await import("../../billing");

    originalGetSubscription = billingModule.polar.getCurrentSubscription;

    billingModule.polar.getCurrentSubscription = mock().mockResolvedValue(null);

    const registeredCreateCard = (await import("../../card/createCard"))
      .createCard;
    const handler =
      (registeredCreateCard as any).handler ?? registeredCreateCard;
    createCard = {
      handler: (ctx: any, args: any) => {
        addCardUsage(ctx);
        return handler(ctx, args);
      },
    };
  });

  afterEach(async () => {
    const billingModule = await import("../../billing");
    billingModule.polar.getCurrentSubscription = originalGetSubscription;
  });

  test("rejects storage keys outside the caller's namespace", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

    const handler = (createCard as any).handler ?? createCard;
    for (const args of [
      { content: "file", fileKey: "users/someone-else/file" },
      { content: "file", thumbnailKey: "stale-bucket/thumb" },
    ]) {
      const error = await handler(ctx, args).catch((e: unknown) => e);
      expect((error as any)?.data).toEqual({
        code: "INVALID_STORAGE_KEY",
        message: expect.stringContaining("does not belong"),
      });
    }
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  test("leaves no card behind when a free user is at the card limit, even if the caller catches the error", async () => {
    const cards = new Map<string, unknown>();
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock(async (_table: string, id: string) => cards.get(id) ?? null),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock((table: string, doc: unknown) => {
          if (table !== "cards") {
            return Promise.resolve(`${table}_1`);
          }
          const id = `card_${cards.size + 1}`;
          cards.set(id, doc);
          return Promise.resolve(id);
        }),
        delete: mock((table: string, id: string) => {
          if (table === "cards") {
            cards.delete(id);
          }
          return Promise.resolve();
        }),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);
    const registered = (await import("../../card/createCard")).createCard;
    const handler = (registered as any)._handler ?? registered;
    addCardUsage(ctx);
    // Every usage shard is full: the free tier's 200 cards are in use.
    const query = ctx.db.query;
    ctx.db.query = mock((table: string) =>
      table === "userCardUsageShards"
        ? {
            withIndex: () => ({
              unique: mock().mockResolvedValue({
                _id: "usage_shard_full",
                activeCardCount: 13,
                shard: 0,
                updatedAt: 1,
                userId: "u1",
              }),
            }),
          }
        : query(table)
    );

    const error = await handler(ctx, { content: "one too many" }).catch(
      (e: unknown) => e
    );

    expect((error as any)?.data?.code).toBe("CARD_LIMIT_REACHED");
    expect([...cards.keys()]).toEqual([]);
    expect(workflow.start).not.toHaveBeenCalled();
  });

  test("keeps an imported bookmark title as an edited title that page titles don't replace", async () => {
    const insert = mock().mockResolvedValue("c1");
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      db: {
        get: mock().mockResolvedValue(null),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert,
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);
    addCardUsage(ctx);
    const { createCardForUserHandler } = await import("../../card/createCard");

    await createCardForUserHandler(
      ctx,
      "u1" as any,
      {
        type: "link",
        content: "My reading list",
        url: "https://example.com/list",
      },
      { importedVisibleFields: { metadataTitle: "  My reading list " } }
    );

    expect(insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        metadataTitle: "My reading list",
        metadataTitleEdited: true,
      })
    );
  });

  test("throws when unauthenticated", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue(null) },
    } as any);

    await expect(
      ((createCard as any).handler ?? createCard)(ctx, { content: "Hello" })
    ).rejects.toThrow("User must be authenticated");
  });

  test("creates quote card when content is quoted", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

    const handler = (createCard as any).handler ?? createCard;
    const cardId = await handler(ctx, {
      content: '"Hello world"',
      source: "web",
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
    expect(ctx.db.insert.mock.calls[0][1]).not.toHaveProperty("source");
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cardSearchDocuments",
      expect.objectContaining({ cardId: "c1", userId: "u1" })
    );
    expect(workflow.start).toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        cardId: "c1",
        cardType: "quote",
        outcome: "success",
        source: "web",
        userId: "u1",
      })
    );
  });

  test("sets metadataStatus pending for link cards", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c2"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

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

  test("honors an explicit text type for a note that mentions a URL", async () => {
    // Regression: a caller that deliberately saves a note as text (e.g.
    // "I read this at https://example.com") should keep a text card. The
    // backend only auto-upgrades URL content to a link when no type is
    // provided, so an explicit type is always honored.
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c_text_url"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "I read this at https://example.com",
      type: "text",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        type: "text",
      })
    );
  });

  test("keeps explicit text stable for URLs, quotes, colors, and Markdown", async () => {
    const insert = mock(async () => "c_explicit");
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert,
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);
    const handler = (createCard as any).handler ?? createCard;
    const sources = [
      "https://example.com",
      '"A quoted note"',
      "#ff00aa, rgb(0, 10, 20)",
      "# Heading\n\n| A | B |\n| - | - |\n| 1 | 2 |",
    ];

    for (const content of sources) {
      await handler(ctx, { content, type: "text" });
    }

    // The inline search sync writes through the same mocked db, so filter
    // the insert calls down to the cards table.
    expect(
      insert.mock.calls
        .filter((call) => call[0] === "cards")
        .map((call) => call[1])
    ).toEqual(
      sources.map((content) =>
        expect.objectContaining({ content, type: "text" })
      )
    );
  });

  test("preserves explicit Markdown text source exactly and enforces UTF-8 bytes", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c_markdown"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);
    const source =
      "\uFEFF  # Heading\r\n- [ ] task\rBody\nhttps://example.com  ";
    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, { content: source, type: "text" });
    expect(ctx.db.insert.mock.calls[0]?.[1]).toMatchObject({
      content: source,
      type: "text",
      url: undefined,
    });

    await expect(
      handler(ctx, {
        content: `${"a".repeat(512 * 1024)}b`,
        type: "text",
      })
    ).rejects.toThrow("512 KiB when encoded as UTF-8");
  });

  test("lets the backend upgrade a URL to a link card when type is omitted", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c_link_auto"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

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

  test("saves a composer-escaped bare URL as a clean link card", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "link",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c_link_escaped"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "https://en.wikipedia.org/wiki/Tectona\\_grandis?a=1&amp;b=2",
    });

    const url = "https://en.wikipedia.org/wiki/Tectona_grandis?a=1&b=2";
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({ type: "link", url, content: url })
    );
  });

  test("keeps implicit text source exact when content has no URL", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c_text"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

    const handler = (createCard as any).handler ?? createCard;
    const content = "\uFEFF  # regular note\r\n\rBody  ";
    await handler(ctx, {
      content,
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "cards",
      expect.objectContaining({
        type: "text",
        content,
      })
    );
  });

  test("rejects unsafe url schemes", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c_unsafe"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

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

  test("normalizes failure classes before scheduling telemetry", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockRejectedValue(new Error("Request timed out")),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

    const handler = (createCard as any).handler ?? createCard;
    await expect(handler(ctx, { content: "Hello" })).rejects.toThrow(
      "Request timed out"
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        errorClass: "TimeoutError",
        outcome: "failure",
        source: "unknown",
      })
    );
  });

  test("builds fileMetadata when fileKey provided", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c3"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "Image",
      fileKey: `${buildR2UserPrefix("u1")}/c/file/key`,
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

  test("drops a caller's link preview and category, with the storage keys in them", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c5"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);
    const someoneElses = "users/victim/cards/c9/link-preview-image/uuid";

    const handler = (createCard as any).handler ?? createCard;
    await handler(ctx, {
      content: "https://example.com/article",
      metadata: {
        source: "web",
        linkPreview: {
          status: "success",
          title: "Forged",
          imageStorageKey: someoneElses,
          screenshotStorageKey: someoneElses,
          rawStorageKey: someoneElses,
          media: [
            {
              type: "video",
              storageKey: someoneElses,
              posterStorageKey: someoneElses,
              updatedAt: 1,
            },
          ],
        },
        linkCategory: { category: "article", rawStorageKey: someoneElses },
      },
      type: "link",
      url: "https://example.com/article",
    });

    const inserted = (ctx.db.insert as any).mock.calls.find(
      ([table]: [string]) => table === "cards"
    )?.[1];
    expect(inserted.metadata).toEqual({ source: "web" });
    expect(JSON.stringify(inserted)).not.toContain("victim");
  });

  test("preserves metadata source when provided", async () => {
    const ctx = withTestSession({
      runMutation: mock().mockResolvedValue({ ok: true }),
      auth: { getUserIdentity: mock().mockResolvedValue({ subject: "u1" }) },
      db: {
        get: mock().mockResolvedValue({
          _id: "c1",
          userId: "u1",
          type: "text",
          content: "Card",
          createdAt: 1,
          updatedAt: 1,
        }),
        system: { get: mock().mockResolvedValue(null) },
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            collect: mock().mockResolvedValue([]),
            take: mock().mockResolvedValue([]),
            unique: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c4"),
      },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any);

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

describe("resolveCreatedCardType", () => {
  test.each([
    [
      "keeps an explicit text type for a note with a URL",
      "text",
      true,
      false,
      "text",
    ],
    ["keeps an explicit type over quotes", "image", false, true, "image"],
    [
      "makes quoted text a quote, even with a URL",
      undefined,
      true,
      true,
      "quote",
    ],
    ["makes a URL without a type a link", undefined, true, false, "link"],
    ["defaults to text", undefined, false, false, "text"],
  ])("%s", async (_name, providedType, hasUrl, isQuoted, expected) => {
    const { resolveCreatedCardType } = await import("../../card/createCard");
    expect(resolveCreatedCardType({ providedType, hasUrl, isQuoted })).toBe(
      expected
    );
  });
});
