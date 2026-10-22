import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import schema from "../schema";
import { MAX_SHUFFLE_SEED } from "../shared/search/shuffle";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Partial<
  Pick<
    Doc<"cards">,
    | "colorHues"
    | "content"
    | "isArchived"
    | "isDeleted"
    | "isFavorited"
    | "shuffleKey"
    | "tags"
    | "type"
    | "url"
    | "urlHost"
  >
>;

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_shuffle",
    email_verified: true,
    external_id: "owner",
  });
  let nextCreatedAt = 1000;
  const insert = (seed: CardSeed) => {
    nextCreatedAt += 1;
    const createdAt = nextCreatedAt;
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: `Card ${createdAt}`,
        createdAt,
        updatedAt: createdAt,
        ...(seed.isDeleted ? { deletedAt: createdAt } : {}),
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  };
  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  const readAll = async (args: Record<string, unknown>, numItems = 7) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let index = 0; index < 200; index += 1) {
      const page: {
        continueCursor: string | null;
        isDone: boolean;
        page: { _id: string }[];
      } = await owner.query(api.cards.searchCardsPaginated, {
        ...args,
        paginationOpts: { numItems, cursor },
      });
      ids.push(...page.page.map((card) => card._id));
      if (page.isDone) {
        return ids;
      }
      cursor = page.continueCursor;
    }
    throw new Error("Paging did not finish");
  };

  return { t, owner, insert, readAll, runScheduled };
};

const seedLibrary = async (
  insert: Awaited<ReturnType<typeof setup>>["insert"],
  count = 40
) => {
  const ids: Id<"cards">[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(
      await insert({
        ...(index % 5 === 0 ? {} : { shuffleKey: ((index * 37) % 101) / 101 }),
        isFavorited: index % 3 === 0 || undefined,
      })
    );
  }
  return ids;
};

const SEEDS = [0, 1, 42, 123_456, MAX_SHUFFLE_SEED];

describe("Shuffle walks the library", () => {
  test.each(SEEDS)(
    "seed %i returns every card once, in the same order every time",
    async (seed) => {
      const { insert, readAll } = await setup();
      const ids = await seedLibrary(insert);
      const first = await readAll({ sort: "shuffle", shuffleSeed: seed });
      expect(first).toHaveLength(ids.length);
      expect(new Set(first)).toEqual(new Set(ids));
      expect(await readAll({ sort: "shuffle", shuffleSeed: seed }, 3)).toEqual(
        first
      );
      expect(await readAll({ sort: "shuffle", shuffleSeed: seed }, 50)).toEqual(
        first
      );
    }
  );

  test("different seeds give different orders, neither by date", async () => {
    const { insert, readAll } = await setup();
    const ids = await seedLibrary(insert);
    const newest = [...ids].reverse();
    const one = await readAll({ sort: "shuffle", shuffleSeed: 1 });
    const two = await readAll({ sort: "shuffle", shuffleSeed: 2 });
    expect(one).not.toEqual(two);
    expect(one).not.toEqual(newest);
    expect(two).not.toEqual(newest);
  });

  test("cards without a key are read once, after the wrap", async () => {
    const { insert, readAll } = await setup();
    const keyed = await insert({ shuffleKey: 0.5 });
    const unkeyed = await insert({});
    const order = await readAll({ sort: "shuffle", shuffleSeed: 0 }, 1);
    expect(new Set(order)).toEqual(new Set([keyed, unkeyed]));
    expect(order).toHaveLength(2);
  });

  test("Trash, Archive and favorites shuffle within themselves", async () => {
    const { insert, readAll } = await setup();
    const active = await insert({ shuffleKey: 0.1 });
    const favorite = await insert({ shuffleKey: 0.9, isFavorited: true });
    const archived = await insert({ shuffleKey: 0.2, isArchived: true });
    const trashed = await insert({ shuffleKey: 0.3, isDeleted: true });
    const trashedArchived = await insert({
      shuffleKey: 0.4,
      isDeleted: true,
      isArchived: true,
    });
    const library = await readAll({ sort: "shuffle", shuffleSeed: 5 });
    expect(new Set(library)).toEqual(new Set([active, favorite]));
    expect(
      await readAll({ sort: "shuffle", shuffleSeed: 5, favoritesOnly: true })
    ).toEqual([favorite]);
    expect(
      await readAll({ sort: "shuffle", shuffleSeed: 5, showArchivedOnly: true })
    ).toEqual([archived]);
    const trash = await readAll({
      sort: "shuffle",
      shuffleSeed: 5,
      showTrashOnly: true,
    });
    expect(new Set(trash)).toEqual(new Set([trashed, trashedArchived]));
    expect(trash).toHaveLength(2);
  });

  test("a card saved mid-paging never repeats or hides another", async () => {
    const { owner, insert } = await setup();
    const ids = await seedLibrary(insert, 20);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let index = 0; index < 50; index += 1) {
      const page: {
        continueCursor: string | null;
        isDone: boolean;
        page: { _id: string }[];
      } = await owner.query(api.cards.searchCardsPaginated, {
        sort: "shuffle",
        shuffleSeed: 9,
        paginationOpts: { numItems: 4, cursor },
      });
      seen.push(...page.page.map((card) => card._id));
      if (index === 1) {
        await insert({ shuffleKey: 0.999 });
        await insert({ shuffleKey: 0.001 });
      }
      if (page.isDone) {
        break;
      }
      cursor = page.continueCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of ids) {
      expect(seen).toContain(id);
    }
  });
});

describe("Shuffle of a set of matches", () => {
  test("search, tag and folder views are complete and stable for a seed", async () => {
    const { owner, insert, readAll, runScheduled } = await setup();
    const designs: Id<"cards">[] = [];
    for (let index = 0; index < 12; index += 1) {
      designs.push(
        await insert({
          content: `Design note ${index}`,
          tags: ["design"],
          shuffleKey: index / 12,
        })
      );
    }
    await insert({ content: "Unrelated", shuffleKey: 0.5 });
    const folder = await owner.mutation(api.folders.createFolder, {
      name: "Picks",
    });
    for (const id of designs.slice(0, 6)) {
      await owner.mutation(api.folders.setCardFolders, {
        cardId: id,
        folderIds: [folder._id],
      });
    }
    await runScheduled();

    for (const args of [
      { searchQuery: "design" },
      { tag: "design" },
      { searchQuery: "tag:design" },
    ]) {
      const order = await readAll({ ...args, sort: "shuffle", shuffleSeed: 3 });
      expect(new Set(order)).toEqual(new Set(designs));
      expect(order).toHaveLength(designs.length);
      expect(
        await readAll({ ...args, sort: "shuffle", shuffleSeed: 3 }, 5)
      ).toEqual(order);
      expect(
        await readAll({ ...args, sort: "shuffle", shuffleSeed: 4 })
      ).not.toEqual(order);
    }

    const inFolder = await readAll({
      folderId: folder._id,
      sort: "shuffle",
      shuffleSeed: 3,
    });
    expect(new Set(inFolder)).toEqual(new Set(designs.slice(0, 6)));
    expect(inFolder).toHaveLength(6);
  });
});

describe("Shuffle with a color filter", () => {
  test("shows each matching card once, the same way for a seed", async () => {
    const { insert, readAll } = await setup();
    const blue = new Set<string>();
    for (let index = 0; index < 30; index += 1) {
      const id = await insert({
        colorHues: index % 3 === 0 ? ["blue"] : ["red"],
        shuffleKey: index / 30,
        type: "image",
      });
      if (index % 3 === 0) {
        blue.add(id);
      }
    }
    const args = { hueFilters: ["blue"], sort: "shuffle", shuffleSeed: 4 };
    const order = await readAll(args, 4);
    expect(order).toHaveLength(blue.size);
    expect(new Set(order)).toEqual(blue);
    expect(await readAll(args, 3)).toEqual(order);
  });
});

describe("Shuffle of one site", () => {
  test("reaches every card on a site with more than 401 of them", async () => {
    const { insert, readAll } = await setup();
    const onSite = new Set<string>();
    for (let index = 0; index < 450; index += 1) {
      onSite.add(
        await insert({
          type: "link",
          url: `https://github.com/teak/${index}`,
          urlHost: "github.com",
          shuffleKey: ((index * 7919) % 1000) / 1000,
        })
      );
    }
    await insert({
      type: "link",
      url: "https://example.com/other",
      urlHost: "example.com",
      shuffleKey: 0.5,
    });
    const args = {
      searchQuery: "site:github.com",
      sort: "shuffle",
      shuffleSeed: 6,
    };
    const order = await readAll(args, 100);
    expect(order).toHaveLength(onSite.size);
    expect(new Set(order)).toEqual(onSite);
  }, 120_000);
});

describe("Shuffle of a large tag in the grid", () => {
  test("reaches every card past a search's 1,000 offset", async () => {
    const { insert, readAll, runScheduled } = await setup();
    const tagged = new Set<string>();
    for (let index = 0; index < 1250; index += 1) {
      tagged.add(await insert({ tags: ["big"], shuffleKey: 0.5 }));
    }
    await runScheduled();
    const order = await readAll(
      { tag: "big", sort: "shuffle", shuffleSeed: 9 },
      100
    );
    expect(order).toHaveLength(tagged.size);
    expect(new Set(order)).toEqual(tagged);
  }, 120_000);
});

describe("GET /v1/cards?sort=shuffle", () => {
  const readApi = async (
    t: Awaited<ReturnType<typeof setup>>["t"],
    args: Record<string, unknown>,
    limit = 6
  ) => {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < 100; index += 1) {
      const page = await t.query(internal.publicApi.shuffleCardsPageForUser, {
        userId: "owner",
        limit,
        ...args,
        ...(cursor ? { cursor } : {}),
      });
      ids.push(...page.items.map((card: { _id: string }) => card._id));
      if (!page.pageInfo.nextCursor) {
        return ids;
      }
      cursor = page.pageInfo.nextCursor;
    }
    throw new Error("Paging did not finish");
  };

  test("pages every card once, the same way for a seed", async () => {
    const { t, insert } = await setup();
    const ids = await seedLibrary(insert, 25);
    const first = await readApi(t, { shuffleSeed: 42 });
    expect(new Set(first)).toEqual(new Set(ids));
    expect(first).toHaveLength(ids.length);
    expect(await readApi(t, { shuffleSeed: 42 }, 4)).toEqual(first);
    expect(await readApi(t, { shuffleSeed: 43 })).not.toEqual(first);
    const favorites = await readApi(t, { shuffleSeed: 42, favorited: true });
    expect(favorites.length).toBeGreaterThan(0);
    expect(favorites.every((id) => first.includes(id))).toBe(true);
  });

  test("a search shuffles its matches and resumes after the last one", async () => {
    const { t, insert } = await setup();
    const matches: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      matches.push(
        await insert({ content: `Shuffle match ${index}`, shuffleKey: 0.5 })
      );
    }
    await insert({ content: "Other", shuffleKey: 0.5 });
    const order = await readApi(t, { shuffleSeed: 7, searchQuery: "match" }, 4);
    expect(new Set(order)).toEqual(new Set(matches));
    expect(order).toHaveLength(matches.length);
  });

  test("a tag with more than a search's 400 matches is read in full", async () => {
    const { t, insert, runScheduled } = await setup();
    const tagged = new Set<string>();
    for (let index = 0; index < 450; index += 1) {
      tagged.add(await insert({ tags: ["Deep"], shuffleKey: 0.5 }));
    }
    await insert({ tags: ["deep"], isDeleted: true });
    await insert({ tags: ["other"] });
    await runScheduled();
    const order = await readApi(t, { shuffleSeed: 11, tag: "deep" }, 100);
    expect(order).toHaveLength(tagged.size);
    expect(new Set(order)).toEqual(tagged);
    expect(await readApi(t, { shuffleSeed: 11, tag: "deep" }, 100)).toEqual(
      order
    );
  }, 60_000);

  test("a cursor only works with its own seed", async () => {
    const { t, insert } = await setup();
    await seedLibrary(insert, 10);
    const page = await t.query(internal.publicApi.shuffleCardsPageForUser, {
      userId: "owner",
      shuffleSeed: 1,
      limit: 3,
    });
    expect(page.pageInfo.nextCursor).not.toBeNull();
    await expect(
      t.query(internal.publicApi.shuffleCardsPageForUser, {
        userId: "owner",
        shuffleSeed: 2,
        limit: 3,
        cursor: page.pageInfo.nextCursor ?? undefined,
      })
    ).rejects.toThrow("`cursor` is invalid");
    await expect(
      t.query(internal.publicApi.shuffleCardsPageForUser, {
        userId: "owner",
        shuffleSeed: 1,
        cursor: btoa(JSON.stringify({ mode: "list", page: "x" })),
      })
    ).rejects.toThrow("`cursor` is invalid");
  });
});

describe("new cards get a Shuffle key", () => {
  test("a created card has one in [0, 1)", async () => {
    const { t, owner } = await setup();
    const id = await owner.mutation(api.cards.createCard, {
      content: "Fresh note",
      type: "text",
    });
    const key = await t.run(
      async (ctx) => (await ctx.db.get("cards", id))?.shuffleKey
    );
    expect(typeof key).toBe("number");
    expect(key).toBeGreaterThanOrEqual(0);
    expect(key).toBeLessThan(1);
  });
});
