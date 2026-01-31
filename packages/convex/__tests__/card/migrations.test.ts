// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";

describe("card/migrations.ts", () => {
  let backfillMetadataSearchFields: any;

  beforeEach(async () => {
    const module = await import("../../card/migrations");
    backfillMetadataSearchFields = module.backfillMetadataSearchFields;
  });

  test("exports backfillMetadataSearchFields", () => {
    expect(backfillMetadataSearchFields).toBeDefined();
  });

  test("returns empty result when no cards need backfill", async () => {
    const ctx = {
      db: {
        query: mock().mockReturnValue({
          filter: mock().mockReturnValue({
            take: mock().mockResolvedValue([]),
          }),
        }),
      },
    } as any;

    const handler = (backfillMetadataSearchFields as any).handler ?? backfillMetadataSearchFields;
    const result = await handler(ctx, {});

    expect(result).toEqual({ updatedCount: 0, hasMore: false });
  });

  test("backfills metadataTitle from linkPreview", async () => {
    const cards = [
      {
        _id: "c1",
        userId: "u1",
        metadata: {
          linkPreview: {
            status: "success",
            title: "Test Title",
            description: "Test Description",
          },
        },
        metadataTitle: undefined,
        metadataDescription: undefined,
      },
    ];

    const ctx = {
      db: {
        query: mock().mockReturnValue({
          filter: mock().mockReturnValue({
            take: mock().mockResolvedValue(cards),
          }),
        }),
        patch: mock().mockResolvedValue(null),
      },
    } as any;

    const handler = (backfillMetadataSearchFields as any).handler ?? backfillMetadataSearchFields;
    const result = await handler(ctx, {});

    expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", {
      updatedAt: expect.any(Number),
      metadataTitle: "Test Title",
      metadataDescription: "Test Description",
    });
    expect(result).toEqual({ updatedCount: 1, hasMore: false });
  });

  test("backfills only metadataTitle when description already exists", async () => {
    const cards = [
      {
        _id: "c1",
        userId: "u1",
        metadata: {
          linkPreview: {
            status: "success",
            title: "Test Title",
          },
        },
        metadataTitle: undefined,
        metadataDescription: "Existing Description",
      },
    ];

    const ctx = {
      db: {
        query: mock().mockReturnValue({
          filter: mock().mockReturnValue({
            take: mock().mockResolvedValue(cards),
          }),
        }),
        patch: mock().mockResolvedValue(null),
      },
    } as any;

    const handler = (backfillMetadataSearchFields as any).handler ?? backfillMetadataSearchFields;
    const result = await handler(ctx, {});

    expect(ctx.db.patch).toHaveBeenCalledWith("cards", "c1", {
      updatedAt: expect.any(Number),
      metadataTitle: "Test Title",
    });
    expect(result).toEqual({ updatedCount: 1, hasMore: false });
  });

  test("skips cards without metadata", async () => {
    const cards = [
      {
        _id: "c1",
        userId: "u1",
        metadata: undefined,
        metadataTitle: undefined,
        metadataDescription: undefined,
      },
    ];

    const ctx = {
      db: {
        query: mock().mockReturnValue({
          filter: mock().mockReturnValue({
            take: mock().mockResolvedValue(cards),
          }),
        }),
        patch: mock().mockResolvedValue(null),
      },
    } as any;

    const handler = (backfillMetadataSearchFields as any).handler ?? backfillMetadataSearchFields;
    const result = await handler(ctx, {});

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(result).toEqual({ updatedCount: 0, hasMore: false });
  });

  test("skips cards when linkPreview status is not success", async () => {
    const cards = [
      {
        _id: "c1",
        userId: "u1",
        metadata: {
          linkPreview: {
            status: "pending",
          },
        },
        metadataTitle: undefined,
        metadataDescription: undefined,
      },
    ];

    const ctx = {
      db: {
        query: mock().mockReturnValue({
          filter: mock().mockReturnValue({
            take: mock().mockResolvedValue(cards),
          }),
        }),
        patch: mock().mockResolvedValue(null),
      },
    } as any;

    const handler = (backfillMetadataSearchFields as any).handler ?? backfillMetadataSearchFields;
    const result = await handler(ctx, {});

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(result).toEqual({ updatedCount: 0, hasMore: false });
  });

  test("handles custom batch size", async () => {
    const ctx = {
      db: {
        query: mock().mockReturnValue({
          filter: mock().mockReturnValue({
            take: mock().mockResolvedValue([]),
          }),
        }),
      },
    } as any;

    const handler = (backfillMetadataSearchFields as any).handler ?? backfillMetadataSearchFields;
    await handler(ctx, { batchSize: 50 });

    const filterMock = ctx.db.query().filter;
    expect(filterMock).toHaveBeenCalled();
    const takeMock = filterMock().take;
    expect(takeMock).toHaveBeenCalledWith(50);
  });

  test("returns hasMore true when batch size is reached", async () => {
    const cards = Array.from({ length: 100 }, (_, i) => ({
      _id: `c${i}`,
      userId: "u1",
      metadata: {
        linkPreview: { status: "success", title: `Title ${i}` },
      },
      metadataTitle: undefined,
      metadataDescription: undefined,
    }));

    const ctx = {
      db: {
        query: mock().mockReturnValue({
          filter: mock().mockReturnValue({
            take: mock().mockResolvedValue(cards.slice(0, 100)),
          }),
        }),
        patch: mock().mockResolvedValue(null),
      },
    } as any;

    const handler = (backfillMetadataSearchFields as any).handler ?? backfillMetadataSearchFields;
    const result = await handler(ctx, { batchSize: 100 });

    expect(result.hasMore).toBe(true);
  });
});
