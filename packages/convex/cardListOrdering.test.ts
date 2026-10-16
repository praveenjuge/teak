/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { syncCardSearchDocumentHandler } from "./card/searchDocumentHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Pick<Doc<"cards">, "content" | "createdAt" | "type"> &
  Partial<Pick<Doc<"cards">, "isArchived" | "isDeleted" | "isFavorited">>;

const LIBRARY: CardSeed[] = [
  { content: "Newest note", type: "text", createdAt: 3000 },
  { content: "Middle note", type: "text", createdAt: 2000 },
  { content: "Imported note", type: "text", createdAt: 1000 },
];

const setup = async (cards: CardSeed[] = LIBRARY) => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workflowTest.register(t);
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  const ids = new Map<string, Id<"cards">>();
  for (const card of cards) {
    const id = await t.run(async (ctx) => {
      const cardId = await ctx.db.insert("cards", {
        userId: "owner",
        ...card,
        updatedAt: card.createdAt,
      });
      await syncCardSearchDocumentHandler(ctx, cardId);
      return cardId;
    });
    ids.set(card.content, id);
  }
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_ordering",
    email_verified: true,
    external_id: "owner",
  });
  return { t, owner, ids };
};

type Owner = Awaited<ReturnType<typeof setup>>["owner"];

const contents = (cards: { content: string }[]) =>
  cards.map((card) => card.content);

const readAllPages = async (
  owner: Owner,
  args: Record<string, unknown> = {}
): Promise<string[]> => {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < 20; index += 1) {
    const page: {
      continueCursor: string | null;
      isDone: boolean;
      page: { content: string }[];
    } = await owner.query(api.cards.searchCardsPaginated, {
      ...args,
      paginationOpts: { numItems: 1, cursor },
    });
    seen.push(...contents(page.page));
    if (page.isDone) {
      return seen;
    }
    cursor = page.continueCursor;
  }
  throw new Error("pagination did not finish");
};

describe("library order follows the saved date", () => {
  test("an imported card sorts by when it was saved, newest first by default", async () => {
    const { owner } = await setup();
    expect(await readAllPages(owner)).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
  });

  test("oldest first reverses the order", async () => {
    const { owner } = await setup();
    expect(await readAllPages(owner, { sort: "oldest" })).toEqual([
      "Imported note",
      "Middle note",
      "Newest note",
    ]);
  });

  test.each([
    ["one type", { types: ["text"] }],
    ["several types", { types: ["text", "link"] }],
    ["favorites", { favoritesOnly: true }],
    ["a date range", { createdAtRange: { start: 0, end: 10_000 } }],
  ])("%s keeps the same order", async (_label, filters) => {
    const { owner } = await setup(
      LIBRARY.map((card) => ({ ...card, isFavorited: true }))
    );
    expect(await readAllPages(owner, filters)).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
    expect(await readAllPages(owner, { ...filters, sort: "oldest" })).toEqual([
      "Imported note",
      "Middle note",
      "Newest note",
    ]);
  });

  test("Trash orders by saved date too", async () => {
    const { owner } = await setup(
      LIBRARY.map((card) => ({ ...card, isDeleted: true }))
    );
    expect(await readAllPages(owner, { showTrashOnly: true })).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
    expect(await readAllPages(owner, { searchQuery: "trash" })).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
  });

  test("text search honors the sort", async () => {
    const { owner } = await setup();
    const search = async (sort: "newest" | "oldest") =>
      contents(
        (
          await owner.query(api.cards.searchCardsPaginated, {
            searchQuery: "note",
            sort,
            paginationOpts: { numItems: 10, cursor: null },
          })
        ).page
      );
    expect(await search("newest")).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
    expect(await search("oldest")).toEqual([
      "Imported note",
      "Middle note",
      "Newest note",
    ]);
  });

  test("cards saved at the same moment page once each, in a stable order", async () => {
    const { owner } = await setup([
      { content: "Twin A", type: "text", createdAt: 5000 },
      { content: "Twin B", type: "text", createdAt: 5000 },
      { content: "Twin C", type: "text", createdAt: 5000 },
    ]);
    const newest = await readAllPages(owner);
    const oldest = await readAllPages(owner, { sort: "oldest" });
    expect(new Set(newest).size).toBe(3);
    expect(newest).toEqual(["Twin C", "Twin B", "Twin A"]);
    expect(oldest).toEqual(["Twin A", "Twin B", "Twin C"]);
  });

  test("archived cards stay out of the library but deleted ones reach Trash", async () => {
    const { owner } = await setup([
      { content: "Kept", type: "text", createdAt: 3000 },
      { content: "Archived", type: "text", createdAt: 2000, isArchived: true },
      {
        content: "Archived then trashed",
        type: "text",
        createdAt: 1000,
        isArchived: true,
        isDeleted: true,
      },
    ]);
    expect(await readAllPages(owner)).toEqual(["Kept"]);
    expect(await readAllPages(owner, { showTrashOnly: true })).toEqual([
      "Archived then trashed",
    ]);
  });

  test("the mobile summaries keep their shape and the same order", async () => {
    const { owner, ids } = await setup();
    const page = await owner.query(
      api.cards.searchMobileCardSummariesPaginated,
      { sort: "oldest", paginationOpts: { numItems: 10, cursor: null } }
    );
    expect(page.page.map((card: { _id: string }) => card._id)).toEqual([
      ids.get("Imported note"),
      ids.get("Middle note"),
      ids.get("Newest note"),
    ]);
    expect(Object.keys(page.page[0] ?? {})).not.toContain("content");
  });
});

describe("public API and Raycast order", () => {
  const readApiPages = async (
    t: Awaited<ReturnType<typeof setup>>["t"],
    sort: "newest" | "oldest"
  ) => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < 20; index += 1) {
      const page = await t.query(internal.publicApi.scanCardsPageForUser, {
        userId: "owner",
        sort,
        scanLimit: 1,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...contents(page.items));
      const next = page.itemCursors.at(-1) ?? page.nextCursor;
      if (!(next && page.nextCursor)) {
        return seen;
      }
      cursor = next;
    }
    throw new Error("pagination did not finish");
  };

  test("GET /v1/cards pages by saved date in both directions", async () => {
    const { t } = await setup();
    expect(await readApiPages(t, "newest")).toEqual([
      "Newest note",
      "Middle note",
      "Imported note",
    ]);
    expect(await readApiPages(t, "oldest")).toEqual([
      "Imported note",
      "Middle note",
      "Newest note",
    ]);
  });

  test("a cursor from the old insertion-order index is refused as invalid input", async () => {
    const { t } = await setup();
    const legacy = btoa(
      JSON.stringify({ mode: "index", cursor: "not-a-cursor", pageOffset: 0 })
    );
    await expect(
      t.query(internal.publicApi.scanCardsPageForUser, {
        userId: "owner",
        cursor: legacy,
        scanLimit: 10,
      })
    ).rejects.toThrow("`cursor` is invalid");
  });

  test("Raycast lists by saved date", async () => {
    const { t } = await setup();
    const cards = await t.query(internal.raycast.searchCardsForUser, {
      userId: "owner",
      sort: "oldest",
      limit: 2,
    });
    expect(contents(cards)).toEqual(["Imported note", "Middle note"]);
  });
});
