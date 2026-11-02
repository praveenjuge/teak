import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  syncCardSearchDocumentHandler,
  syncCardSearchTagsBatchHandler,
} from "../card/searchSync";
import schema from "../schema";
import { MAX_PINNED_CARDS } from "../shared/pins";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Pick<Doc<"cards">, "content" | "type"> &
  Partial<Omit<Doc<"cards">, "_id" | "_creationTime" | "userId">>;

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConvexError
      ? (error.data as { code?: string }).code
      : String(error);
  }
  return "resolved";
};

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const workosUserId = await seedWorkosOwner(t, "owner");
  await seedWorkosOwner(t, "stranger");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_pins",
    email_verified: true,
    external_id: "owner",
  });

  let clock = 1000;
  const insert = async (content: string, seed: Partial<CardSeed> = {}) => {
    clock += 1;
    const createdAt = clock;
    const cardId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content,
        createdAt,
        updatedAt: createdAt,
        savedAt: createdAt,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      for (let step = 0; step < 10; step += 1) {
        await syncCardSearchTagsBatchHandler(ctx, id);
      }
      return id;
    });
    return cardId;
  };

  const pin = (cardId: Id<"cards">, pinned = true) =>
    owner.mutation(api.cards.setCardPinned, { cardId, pinned });

  const pinned = async () =>
    (await owner.query(api.cards.getPinnedCards, {})).map(
      (card: { content: string }) => card.content
    );

  const grid = async (args: Record<string, unknown> = {}) =>
    (
      await owner.query(api.cards.searchCardsPaginated, {
        paginationOpts: { numItems: 50, cursor: null },
        ...args,
      })
    ).page.map((card: { content: string }) => card.content);

  return { t, owner, insert, pin, pinned, grid };
};

describe("pinning cards to the top of the library", () => {
  test("a new pin goes first, and pinning twice changes nothing", async () => {
    const { insert, pin, pinned } = await setup();
    const a = await insert("Alpha");
    const b = await insert("Bravo");
    await pin(a);
    await pin(b);
    await pin(a);
    expect(await pinned()).toEqual(["Bravo", "Alpha"]);
    await pin(b, false);
    await pin(b, false);
    expect(await pinned()).toEqual(["Alpha"]);
  });

  test(`refuses a pin past ${MAX_PINNED_CARDS} cards with PIN_LIMIT_REACHED`, async () => {
    const { insert, pin, pinned } = await setup();
    for (let index = 0; index < MAX_PINNED_CARDS; index += 1) {
      await pin(await insert(`Card ${index}`));
    }
    const extra = await insert("One too many");
    expect(await errorCode(pin(extra))).toBe("PIN_LIMIT_REACHED");
    expect(await pinned()).toHaveLength(MAX_PINNED_CARDS);
    expect(await pinned()).not.toContain("One too many");
  });

  test("someone else's card can't be pinned", async () => {
    const { insert, owner } = await setup();
    const theirs = await insert("Theirs", {});
    await owner.run((ctx) =>
      ctx.db.patch("cards", theirs, { userId: "stranger" })
    );
    expect(
      await errorCode(
        owner.mutation(api.cards.setCardPinned, {
          cardId: theirs,
          pinned: true,
        })
      )
    ).toBe("NOT_FOUND");
  });

  test("reorder takes every pinned card once, and refuses any other list", async () => {
    const { insert, owner, pin, pinned } = await setup();
    const a = await insert("Alpha");
    const b = await insert("Bravo");
    const c = await insert("Charlie");
    for (const id of [a, b, c]) {
      await pin(id);
    }
    expect(await pinned()).toEqual(["Charlie", "Bravo", "Alpha"]);
    await owner.mutation(api.cards.reorderPinnedCards, { cardIds: [a, c, b] });
    expect(await pinned()).toEqual(["Alpha", "Charlie", "Bravo"]);
    for (const cardIds of [
      [a, c],
      [a, c, b, b],
      [a, c, await insert("Not pinned")],
    ]) {
      expect(
        await errorCode(
          owner.mutation(api.cards.reorderPinnedCards, { cardIds })
        )
      ).toBe("INVALID_INPUT");
    }
    expect(await pinned()).toEqual(["Alpha", "Charlie", "Bravo"]);
  });

  test("archiving or trashing unpins, and restoring doesn't pin again", async () => {
    const { insert, owner, pin, pinned } = await setup();
    const archived = await insert("Archived");
    const trashed = await insert("Trashed");
    const bulk = await insert("Bulk archived");
    const done = await insert("Done link", {
      type: "link",
      url: "https://example.com/a",
    });
    for (const id of [archived, trashed, bulk, done]) {
      await pin(id);
    }
    await owner.mutation(api.cards.updateCardField, {
      cardId: archived,
      field: "archive",
    });
    await owner.mutation(api.cards.updateCardField, {
      cardId: trashed,
      field: "delete",
    });
    await owner.mutation(api.cards.bulkUpdateCards, {
      cardIds: [bulk],
      action: "archive",
    });
    await owner.mutation(api.cards.updateCardField, {
      cardId: done,
      field: "done",
    });
    expect(await pinned()).toEqual(["Done link"]);

    await owner.mutation(api.cards.updateCardField, {
      cardId: archived,
      field: "unarchive",
    });
    await owner.mutation(api.cards.updateCardField, {
      cardId: trashed,
      field: "restore",
    });
    expect(await pinned()).toEqual(["Done link"]);
    expect(await errorCode(pin(bulk))).toBe("CONFLICT");
  });

  test("the plain library leaves pins out only when asked; search finds them", async () => {
    const { insert, pin, grid } = await setup();
    const a = await insert("Alpha note");
    await insert("Bravo note");
    await pin(a);
    expect(await grid()).toEqual(["Bravo note", "Alpha note"]);
    expect(await grid({ excludePinned: true })).toEqual(["Bravo note"]);
    expect(await grid({ searchQuery: "is:pinned" })).toEqual(["Alpha note"]);
    expect(await grid({ searchQuery: "-is:pinned" })).toEqual(["Bravo note"]);
    expect(await grid({ searchQuery: "note is:pin" })).toEqual(["Alpha note"]);
    expect(await grid({ searchQuery: "is:fav OR is:pinned" })).toEqual([
      "Alpha note",
    ]);
  });

  test("the public API lists pins in their order and pins by id", async () => {
    const { t, insert, pin } = await setup();
    const a = await insert("Alpha");
    const b = await insert("Bravo", { isFavorited: true });
    await pin(a);
    await pin(b);

    const page = await t.query(internal.publicApi.pinnedCardsPageForUser, {
      userId: "owner",
    });
    expect(page.items.map((card: { content: string }) => card.content)).toEqual(
      ["Bravo", "Alpha"]
    );
    expect(page.pageInfo).toEqual({ nextCursor: null, hasMore: false });
    const favorites = await t.query(internal.publicApi.pinnedCardsPageForUser, {
      userId: "owner",
      favorited: true,
    });
    expect(
      favorites.items.map((card: { content: string }) => card.content)
    ).toEqual(["Bravo"]);
    expect(
      (
        await t.query(internal.publicApi.pinnedCardsPageForUser, {
          userId: "owner",
          archived: "only",
        })
      ).items
    ).toEqual([]);

    const unpinned = await t.mutation(
      internal.publicApi.cardsForUser.setCardPinnedForUser,
      { userId: "owner", cardId: a, isPinned: false }
    );
    expect(unpinned?.changed).toBe(true);
    expect(unpinned?.card.pinPosition).toBeUndefined();
    const again = await t.mutation(
      internal.publicApi.cardsForUser.setCardPinnedForUser,
      { userId: "owner", cardId: a, isPinned: false }
    );
    expect(again?.changed).toBe(false);

    await pin(a);
    const ordered = await t.mutation(
      internal.publicApi.cardsForUser.reorderPinnedCardsForUser,
      { userId: "owner", cardIds: [b, a] }
    );
    expect(ordered.map((card: { content: string }) => card.content)).toEqual([
      "Bravo",
      "Alpha",
    ]);
  });
});
