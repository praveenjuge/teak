// @ts-nocheck

import { describe, expect, mock, test } from "bun:test";
import { listCardsV1 } from "../publicApiHttp";

const authorize = () =>
  mock()
    .mockResolvedValueOnce({
      access: "full_access",
      keyId: "key_1",
      rateLimitKey: "component:key_1",
      source: "component",
      userId: "user_1",
    })
    .mockResolvedValueOnce({ ok: true, retryAt: undefined });

const card = (id: string, createdAt: number) => ({
  _id: id,
  aiTags: [],
  createdAt,
  isFavorited: false,
  metadataDescription: undefined,
  metadataTitle: undefined,
  tags: [],
  type: "text",
  updatedAt: createdAt,
  url: undefined,
});

const requestPage = async (
  runQuery: ReturnType<typeof mock>,
  cursor?: string,
  limit = 1
) => {
  const handler = (listCardsV1 as any).handler ?? listCardsV1;
  const url = new URL("https://example.com/v1/cards");
  url.searchParams.set("limit", String(limit));
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const response = await handler(
    { runMutation: authorize(), runQuery },
    new Request(url, {
      headers: {
        Authorization:
          "Bearer teakapi_secret_live_a1b2c3d4_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    })
  );

  expect(response.status).toBe(200);
  return response.json();
};

describe("public API card-list pagination", () => {
  test("fills limit=1 across sparse scans without duplicates or skips", async () => {
    const scans = {
      start: {
        itemCursors: [],
        items: [],
        nextCursor: "sparse-1",
        scannedRows: 100,
      },
      "sparse-1": {
        itemCursors: ["after-card-1"],
        items: [card("card_1", 1)],
        nextCursor: "card-2-page",
        scannedRows: 100,
      },
      "card-2-page": {
        itemCursors: ["after-card-2"],
        items: [card("card_2", 2)],
        nextCursor: "sparse-2",
        scannedRows: 50,
      },
      "sparse-2": {
        itemCursors: [],
        items: [],
        nextCursor: "card-3-page",
        scannedRows: 25,
      },
      "card-3-page": {
        itemCursors: ["after-card-3"],
        items: [card("card_3", 3)],
        nextCursor: "end",
        scannedRows: 25,
      },
      end: {
        itemCursors: [],
        items: [],
        nextCursor: null,
        scannedRows: 10,
      },
    };
    const requestedCursors: Array<string | undefined> = [];
    const runQuery = mock((_reference, args) => {
      requestedCursors.push(args.cursor);
      return Promise.resolve(scans[args.cursor ?? "start"]);
    });

    const first = await requestPage(runQuery);
    const second = await requestPage(runQuery, first.pageInfo.nextCursor);
    const third = await requestPage(runQuery, second.pageInfo.nextCursor);

    expect(
      [...first.items, ...second.items, ...third.items].map((item) => item.id)
    ).toEqual(["card_1", "card_2", "card_3"]);
    expect(first.pageInfo).toEqual({
      hasMore: true,
      nextCursor: "card-2-page",
    });
    expect(second.pageInfo).toEqual({
      hasMore: true,
      nextCursor: "card-3-page",
    });
    expect(third.pageInfo).toEqual({
      hasMore: false,
      nextCursor: null,
    });
    expect(requestedCursors).toEqual([
      undefined,
      "sparse-1",
      "card-2-page",
      "card-2-page",
      "sparse-2",
      "card-3-page",
      "card-3-page",
      "end",
    ]);
  });

  test("clamps the public limit to 100 and returns a full page", async () => {
    const firstPageItems = Array.from({ length: 100 }, (_, index) =>
      card(`card_${index + 1}`, index + 1)
    );
    const runQuery = mock((_reference, args) => {
      if (!args.cursor) {
        return Promise.resolve({
          itemCursors: firstPageItems.map(
            (_, index) => `after-card-${index + 1}`
          ),
          items: firstPageItems,
          nextCursor: "page-2",
          scannedRows: 100,
        });
      }

      return Promise.resolve({
        itemCursors: ["after-card-101"],
        items: [card("card_101", 101)],
        nextCursor: null,
        scannedRows: 1,
      });
    });

    const result = await requestPage(runQuery, undefined, 999);

    expect(result.items).toHaveLength(100);
    expect(result.pageInfo).toEqual({
      hasMore: true,
      nextCursor: "page-2",
    });
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runQuery.mock.calls[0][1].scanLimit).toBe(100);
    expect(runQuery.mock.calls[1][1].scanLimit).toBe(100);
  });

  test("stops scanning after 400 rows and returns a continuation", async () => {
    const runQuery = mock((_reference, args) => {
      const page = args.cursor ? Number(args.cursor.slice(5)) : 0;
      return Promise.resolve({
        itemCursors: [],
        items: [],
        nextCursor: `page-${page + 1}`,
        scannedRows: 100,
      });
    });

    const result = await requestPage(runQuery, undefined, 10);

    expect(result.items).toEqual([]);
    expect(result.pageInfo).toEqual({
      hasMore: true,
      nextCursor: "page-4",
    });
    expect(runQuery).toHaveBeenCalledTimes(4);
  });
});
