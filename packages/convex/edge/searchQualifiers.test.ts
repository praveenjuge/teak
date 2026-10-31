import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { expressionTextReader } from "../card/searchPlanner";
import {
  patchCardWithSearchSync,
  syncCardSearchDocumentHandler,
} from "../card/searchSync";
import schema from "../schema";
import { parseSearchQuery } from "../shared/search/qualifiers";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Pick<Doc<"cards">, "content"> &
  Partial<Omit<Doc<"cards">, "_id" | "_creationTime" | "userId">>;

let nextCreatedAt = 1000;

const setup = async () => {
  nextCreatedAt = 1000;
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const workosUserId = await seedWorkosOwner(t, "owner");
  const strangerWorkosId = await seedWorkosOwner(t, "stranger");
  const identity = (subject: string, externalId: string) =>
    t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject,
      sid: `session_${externalId}`,
      email_verified: true,
      external_id: externalId,
    });
  const owner = identity(workosUserId, "owner");
  const stranger = identity(strangerWorkosId, "stranger");

  const insert = (seed: CardSeed, userId = "owner") => {
    nextCreatedAt += 1;
    const createdAt = nextCreatedAt;
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId,
        type: seed.url ? "link" : "text",
        createdAt,
        updatedAt: createdAt,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  };

  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));

  const searchDocument = (cardId: Id<"cards">) =>
    t.run((ctx) =>
      ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
        .unique()
    );

  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  const search = async (
    searchQuery: string,
    args: Record<string, unknown> = {},
    as = owner
  ) => {
    await runScheduled();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let index = 0; index < 50; index += 1) {
      const result: {
        continueCursor: string | null;
        isDone: boolean;
        page: { content: string }[];
      } = await as.query(api.cards.searchCardsPaginated, {
        searchQuery,
        ...args,
        paginationOpts: { numItems: 2, cursor },
      });
      seen.push(...result.page.map((item) => item.content));
      if (result.isDone || !result.continueCursor) {
        return seen;
      }
      cursor = result.continueCursor;
    }
    throw new Error("search did not finish");
  };

  return {
    t,
    owner,
    stranger,
    insert,
    card,
    searchDocument,
    search,
    runScheduled,
  };
};

describe("urlHost", () => {
  test("follows the card's URL on every write, and the search document mirrors it", async () => {
    const { t, insert, card, searchDocument } = await setup();
    const id = await insert({
      content: "Repo",
      url: "https://WWW.GitHub.com/teak",
    });
    expect((await card(id))?.urlHost).toBe("github.com");
    expect((await searchDocument(id))?.urlHost).toBe("github.com");

    await t.run((ctx) =>
      patchCardWithSearchSync(ctx, id, { url: "https://例え.jp/page" })
    );
    expect((await card(id))?.urlHost).toBe("xn--r8jz45g.jp");
    expect((await searchDocument(id))?.urlHost).toBe("xn--r8jz45g.jp");

    await t.run((ctx) => patchCardWithSearchSync(ctx, id, { url: undefined }));
    expect((await card(id))?.urlHost).toBeUndefined();
    expect((await searchDocument(id))?.urlHost).toBeUndefined();
  });

  test("updateCard keeps the host in step with an edited URL", async () => {
    const { owner, insert, card } = await setup();
    const id = await insert({ content: "Link", url: "https://a.example" });
    await owner.mutation(api.cards.updateCard, {
      id,
      url: "https://www.b.example/x",
    });
    expect((await card(id))?.urlHost).toBe("b.example");
  });
});

describe("sourceUrl", () => {
  const saveQuote = (
    t: Awaited<ReturnType<typeof setup>>["t"],
    args: Record<string, unknown>
  ) =>
    t.mutation(internal.publicApi.cardsForUser.quickSaveForUser, {
      userId: "owner",
      cardType: "text",
      ...args,
    });

  test("a text card saved from a page is on that page's site", async () => {
    const { t, owner, card, searchDocument, search } = await setup();
    const { cardId } = await saveQuote(t, {
      content: "A quote from the essay",
      sourceTitle: "An essay",
      sourceUrl: "https://www.Example.com/essay",
    });
    expect(await card(cardId)).toMatchObject({
      sourceTitle: "An essay",
      sourceUrl: "https://www.Example.com/essay",
      type: "text",
      urlHost: "example.com",
    });
    expect((await card(cardId))?.url).toBeUndefined();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await searchDocument(cardId))?.urlHost).toBe("example.com");
    expect(await search("site:example.com")).toEqual([
      "A quote from the essay",
    ]);
    expect(await search("site:example.com quote")).toEqual([
      "A quote from the essay",
    ]);
    expect(await owner.query(api.cards.listTopSites, {})).toEqual([
      { host: "example.com", label: "example.com", count: 1 },
    ]);
  });

  test("the duplicate check never matches a card's sourceUrl", async () => {
    const { t } = await setup();
    await saveQuote(t, {
      content: "Quoted",
      sourceUrl: "https://example.com/essay",
    });
    expect(
      await t.query(internal.card.findDuplicateCard.findDuplicateCardForUser, {
        userId: "owner",
        url: "https://example.com/essay",
      })
    ).toBeNull();
  });

  test("a link's own url decides its site", async () => {
    const { t, card } = await setup();
    const { cardId } = await t.mutation(
      internal.publicApi.cardsForUser.quickSaveForUser,
      {
        userId: "owner",
        sourceUrl: "https://found-it-here.example",
        url: "https://github.com/acme",
      }
    );
    expect(await card(cardId)).toMatchObject({
      sourceUrl: "https://found-it-here.example",
      urlHost: "github.com",
    });
  });

  test("clearing a card's url falls back to its sourceUrl's site", async () => {
    const { t, insert, card, searchDocument } = await setup();
    const id = await insert({
      content: "Was a link",
      sourceUrl: "https://example.com/a",
      url: "https://github.com/acme",
    });
    expect((await card(id))?.urlHost).toBe("github.com");
    await t.run((ctx) => patchCardWithSearchSync(ctx, id, { url: undefined }));
    expect((await card(id))?.urlHost).toBe("example.com");
    expect((await searchDocument(id))?.urlHost).toBe("example.com");
  });

  test("refuses an unsafe or oversized sourceUrl", async () => {
    const { t } = await setup();
    await expect(
      saveQuote(t, { content: "x", sourceUrl: "javascript:alert(1)" })
    ).rejects.toThrow("`sourceUrl` must use the http or https scheme");
    await expect(
      saveQuote(t, {
        content: "x",
        sourceUrl: `https://example.com/${"a".repeat(3000)}`,
      })
    ).rejects.toThrow("`sourceUrl` must be at most 2048 characters");
  });
});

const seedLibrary = async (
  insert: Awaited<ReturnType<typeof setup>>["insert"]
) => {
  await insert({
    content: "Design system on GitHub",
    url: "https://github.com/acme/ds",
    tags: ["Design"],
  });
  await insert({
    content: "GitHub notes",
    url: "https://www.github.com/acme/notes",
    tags: ["notes"],
  });
  await insert({
    content: "Blog post about design",
    url: "https://blog.example.com/post",
    tags: ["design", "writing"],
    isFavorited: true,
  });
  await insert({
    content: "Example home",
    url: "https://example.com",
    tags: ["design"],
  });
  await insert({
    content: "Archived GitHub design",
    url: "https://github.com/old",
    tags: ["design"],
    isArchived: true,
  });
  await insert({
    content: "Trashed GitHub design",
    url: "https://github.com/gone",
    tags: ["design"],
    isDeleted: true,
    deletedAt: 1,
  });
  await insert({
    content: "Trashed archived design",
    url: "https://github.com/gone-archived",
    tags: ["design"],
    isDeleted: true,
    deletedAt: 1,
    isArchived: true,
  });
  await insert({ content: "Plain design system note", tags: ["design"] });
};

describe("search qualifiers", () => {
  test("site: matches the exact host however it is written", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    const github = ["GitHub notes", "Design system on GitHub"];
    expect(await search("site:github.com")).toEqual(github);
    expect(await search("site:WWW.GITHUB.COM")).toEqual(github);
    expect(await search("site:https://github.com/anything")).toEqual(github);
    expect(await search("site:example.com")).toEqual(["Example home"]);
  });

  test("several sites match any of them; tags must all match", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    expect(await search("site:example.com site:blog.example.com")).toEqual([
      "Example home",
      "Blog post about design",
    ]);
    expect(await search("tag:design tag:writing")).toEqual([
      "Blog post about design",
    ]);
    expect(await search("#design #notes")).toEqual([]);
  });

  test("the roadmap example returns exactly the matching card, in either sort", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    const query = 'tag:design type:link site:github.com "design system"';
    expect(await search(query)).toEqual(["Design system on GitHub"]);
    expect(await search(query, { sort: "oldest" })).toEqual([
      "Design system on GitHub",
    ]);
  });

  test("text with a site reads the search index for that host", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    expect(await search("site:github.com notes")).toEqual(["GitHub notes"]);
    expect(await search("design site:example.com")).toEqual(["Example home"]);
  });

  test("quoted phrases match as written", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    expect(await search('"design system"')).toEqual([
      "Plain design system note",
      "Design system on GitHub",
    ]);
    expect(await search('"system design"')).toEqual([]);
  });

  test("type: narrows and merges with the view's types", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    expect(await search("tag:design type:text")).toEqual([
      "Plain design system note",
    ]);
    expect(await search("type:links tag:design", { types: ["link"] })).toEqual([
      "Example home",
      "Blog post about design",
      "Design system on GitHub",
    ]);
    expect(await search("type:text", { types: ["link"] })).toEqual([]);
  });

  test("is:fav and is:archived read favorites and Archive", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    expect(await search("is:fav")).toEqual(["Blog post about design"]);
    expect(await search("is:fav tag:design")).toEqual([
      "Blog post about design",
    ]);
    expect(await search("is:archived")).toEqual(["Archived GitHub design"]);
    expect(await search("is:archived site:github.com")).toEqual([
      "Archived GitHub design",
    ]);
    expect(await search("site:github.com")).not.toContain(
      "Archived GitHub design"
    );
    expect(await search("is:archived", { showTrashOnly: true })).toEqual([
      "Trashed archived design",
    ]);
    expect(await search("site:github.com", { showTrashOnly: true })).toEqual([
      "Trashed archived design",
      "Trashed GitHub design",
    ]);
  });

  test("folder: resolves names; unknown and other users' folders match nothing", async () => {
    const { owner, stranger, insert, search } = await setup();
    await seedLibrary(insert);
    const reading = await owner.mutation(api.folders.createFolder, {
      name: 'Reading "list"',
    });
    const work = await owner.mutation(api.folders.createFolder, {
      name: "Work",
    });
    await stranger.mutation(api.folders.createFolder, { name: "Secret" });
    const inBoth = await insert({ content: "In both folders", tags: ["x"] });
    const inReading = await insert({ content: "Only reading" });
    await owner.mutation(api.folders.setCardFolders, {
      cardId: inBoth,
      folderIds: [reading._id, work._id],
    });
    await owner.mutation(api.folders.setCardFolders, {
      cardId: inReading,
      folderIds: [reading._id],
    });

    expect(await search('folder:"reading \\"LIST\\""')).toEqual([
      "Only reading",
      "In both folders",
    ]);
    expect(await search('folder:"Reading \\"list\\"" folder:work')).toEqual([
      "In both folders",
    ]);
    expect(await search("folder:work #x")).toEqual(["In both folders"]);
    expect(await search("folder:work", { folderId: reading._id })).toEqual([
      "In both folders",
    ]);
    await owner.mutation(api.folders.deleteFolder, { folderId: work._id });
    const newWork = await owner.mutation(api.folders.createFolder, {
      name: "WORK",
    });
    await owner.mutation(api.folders.setCardFolders, {
      cardId: inReading,
      folderIds: [reading._id, newWork._id],
    });
    expect(await search("folder:work")).toEqual(["Only reading"]);
    expect(await search("folder:nope")).toEqual([]);
    expect(await search("folder:secret")).toEqual([]);
    expect(await search("folder:work", {}, stranger)).toEqual([]);
  });

  test("bare quick commands still work and qualifiers turn them off", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    expect(await search("fav")).toEqual(["Blog post about design"]);
    expect(await search("trash")).toEqual([
      "Trashed archived design",
      "Trashed GitHub design",
    ]);
    expect(await search("trash site:github.com")).toEqual([]);
  });

  test("unknown qualifiers and hex colors search as text", async () => {
    const { insert, search } = await setup();
    await insert({ content: "color #fff swatch" });
    await insert({ content: "talk about foo:bar here" });
    expect(await search("#fff")).toEqual(["color #fff swatch"]);
    expect(await search("foo:bar")).toEqual(["talk about foo:bar here"]);
  });

  test("a site alone returns the page size asked for", async () => {
    const { owner, insert, runScheduled } = await setup();
    for (let index = 0; index < 5; index += 1) {
      await insert({
        content: `repo ${index}`,
        url: `https://github.com/${index}`,
      });
    }
    await runScheduled();
    const first = await owner.query(api.cards.searchCardsPaginated, {
      searchQuery: "site:github.com",
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page.map((item: { content: string }) => item.content)).toEqual(
      ["repo 4", "repo 3"]
    );
    expect(first.isDone).toBe(false);
  });

  test("a site with more cards than one batch pages to the end", async () => {
    const { insert, search } = await setup();
    for (let index = 0; index < 230; index += 1) {
      await insert({
        content: `noise ${index}`,
        url: `https://noise.example/${index}`,
      });
    }
    await insert({ content: "oldest match", url: "https://a.example/1" });
    for (let index = 0; index < 5; index += 1) {
      await insert({ content: `more noise ${index}` });
    }
    await insert({ content: "newest match", url: "https://b.example/1" });
    expect(await search("site:a.example site:b.example")).toEqual([
      "newest match",
      "oldest match",
    ]);
  });
});

const productMetadata = (
  url: string,
  price?: { amount: number; currency?: string }
) => ({
  linkCategory: {
    category: "product" as const,
    fetchedAt: 1,
    sourceUrl: url,
    ...(price ? { price } : {}),
  },
});

describe("price:", () => {
  const seedProducts = async (
    insert: Awaited<ReturnType<typeof setup>>["insert"]
  ) => {
    const product = (
      content: string,
      price?: { amount: number; currency?: string },
      extra: Partial<Doc<"cards">> = {}
    ) => {
      const url = `https://shop.example/${encodeURIComponent(content)}`;
      return insert({
        content,
        url,
        metadata: productMetadata(url, price),
        ...extra,
      });
    };
    await product("Cheap lamp", { amount: 9.99, currency: "USD" });
    await product("Desk lamp", { amount: 49.5, currency: "EUR" });
    await product("Floor lamp", { amount: 120, currency: "GBP" });
    await product("Free lamp sticker", { amount: 0 });
    await product("Lamp without a price");
    await product(
      "Archived lamp",
      { amount: 10, currency: "USD" },
      { isArchived: true }
    );
    await insert({
      content: "Lamp shopping note",
      metadata: productMetadata("https://x.example", { amount: 5 }),
    });
  };

  test("bounds compare the amount in any currency and add up to a range", async () => {
    const { insert, search } = await setup();
    await seedProducts(insert);
    expect(await search("price:<50")).toEqual([
      "Free lamp sticker",
      "Desk lamp",
      "Cheap lamp",
    ]);
    expect(await search("price:>20 price:<=120")).toEqual([
      "Floor lamp",
      "Desk lamp",
    ]);
    expect(await search("price:=0")).toEqual(["Free lamp sticker"]);
    expect(await search("price:<100 price:>200")).toEqual([]);
    expect(await search("price:<50 is:archived")).toEqual(["Archived lamp"]);
    expect(await search("price:<50", { sort: "oldest" })).toEqual([
      "Cheap lamp",
      "Desk lamp",
      "Free lamp sticker",
    ]);
  });

  test("a card without a price never matches, and words narrow the bound", async () => {
    const { insert, search } = await setup();
    await seedProducts(insert);
    expect(await search("lamp price:>=0")).toEqual([
      "Free lamp sticker",
      "Floor lamp",
      "Desk lamp",
      "Cheap lamp",
    ]);
    expect(await search("desk price:<100")).toEqual(["Desk lamp"]);
    expect(await search("price:<100", { types: ["text"] })).toEqual([]);
    expect(await search("price:<100 type:text")).toEqual([]);
    expect(await search("price:cheap")).toEqual([]);
  });

  test("a bound pages through more cards than one batch", async () => {
    const { insert, search } = await setup();
    const url = "https://shop.example/oldest";
    await insert({
      content: "oldest match",
      url,
      metadata: productMetadata(url, { amount: 5 }),
    });
    for (let index = 0; index < 230; index += 1) {
      const noiseUrl = `https://noise.example/${index}`;
      await insert({
        content: `noise ${index}`,
        url: noiseUrl,
        metadata: productMetadata(noiseUrl, { amount: 500 + index }),
      });
    }
    const newestUrl = "https://shop.example/newest";
    await insert({
      content: "newest match",
      url: newestUrl,
      metadata: productMetadata(newestUrl, { amount: 7 }),
    });
    expect(await search("price:<10")).toEqual(["newest match", "oldest match"]);
  });

  test("a smart folder's bound and a typed one make a range", async () => {
    const { owner, insert, search } = await setup();
    await seedProducts(insert);
    const folder = await owner.mutation(api.folders.createFolder, {
      name: "Under 100",
      kind: "smart",
      query: "price:<100",
    });
    expect(await search("", { folderId: folder._id })).toEqual([
      "Free lamp sticker",
      "Desk lamp",
      "Cheap lamp",
    ]);
    expect(await search("price:>20", { folderId: folder._id })).toEqual([
      "Desk lamp",
    ]);
  });

  test("another user's priced cards never match", async () => {
    const { insert, search, stranger } = await setup();
    const url = "https://shop.example/theirs";
    await insert(
      {
        content: "Their lamp",
        url,
        metadata: productMetadata(url, { amount: 1 }),
      },
      "stranger"
    );
    expect(await search("price:<10")).toEqual([]);
    expect(await search("price:<10", {}, stranger)).toEqual(["Their lamp"]);
  });

  test("the API's search and scan pages take the bounds", async () => {
    const { t, insert, runScheduled } = await setup();
    await seedProducts(insert);
    await runScheduled();
    const contents = (page: { items: { content: string }[] }) =>
      page.items.map((item) => item.content);
    const prices = [
      { op: ">" as const, amount: 5 },
      { op: "<" as const, amount: 100 },
    ];
    expect(
      contents(
        await t.query(internal.publicApi.searchCardsPageForUser, {
          userId: "owner",
          searchQuery: "lamp",
          type: "link",
          prices,
        })
      )
    ).toEqual(["Desk lamp", "Cheap lamp"]);
    expect(
      contents(
        await t.query(internal.publicApi.scanCardsPageForUser, {
          userId: "owner",
          scanLimit: 50,
          type: "link",
          prices,
        })
      )
    ).toEqual(["Desk lamp", "Cheap lamp"]);
    expect(
      contents(
        await t.query(internal.publicApi.shuffleCardsPageForUser, {
          userId: "owner",
          shuffleSeed: 3,
          limit: 50,
          type: "link",
          prices,
        })
      ).sort()
    ).toEqual(["Cheap lamp", "Desk lamp"]);
  });
});

const categoryMetadata = (
  url: string,
  category: "article" | "book" | "movie" | "repo"
) => ({
  linkCategory: { category, fetchedAt: 1, sourceUrl: url },
});

describe("is:done and is:todo", () => {
  const seedReading = async (
    insert: Awaited<ReturnType<typeof setup>>["insert"]
  ) => {
    const link = (
      content: string,
      category: "article" | "book" | "movie" | "repo" | undefined,
      extra: Partial<Doc<"cards">> = {}
    ) => {
      const url = `https://read.example/${encodeURIComponent(content)}`;
      return insert({
        content,
        url,
        ...(category ? { metadata: categoryMetadata(url, category) } : {}),
        ...extra,
      });
    };
    const ids = {
      read: await link("Read article", "article", { completedAt: 5 }),
      unread: await link("Unread article", "article"),
      film: await link("Film to watch", "movie"),
      repo: await link("A repository", "repo"),
      pending: await link("A link still being read", undefined),
      archived: await link("Archived read book", "book", {
        completedAt: 5,
        isArchived: true,
      }),
      trashed: await link("Trashed read article", "article", {
        completedAt: 5,
        isDeleted: true,
      }),
    };
    await insert({ content: "A note", completedAt: 5 });
    return ids;
  };

  test("is:done lists done links, is:todo what is left to finish", async () => {
    const { insert, search } = await setup();
    await seedReading(insert);
    expect(await search("is:done")).toEqual(["Read article"]);
    expect(await search("is:todo")).toEqual([
      "Film to watch",
      "Unread article",
    ]);
    expect(await search("is:todo film")).toEqual(["Film to watch"]);
    expect(await search("is:done is:todo")).toEqual([]);
    expect(await search("is:todo type:image")).toEqual([]);
    expect(await search("is:todo", { types: ["text"] })).toEqual([]);
    expect(await search("is:done is:archived")).toEqual(["Archived read book"]);
    expect(await search("is:done", { showTrashOnly: true })).toEqual([
      "Trashed read article",
    ]);
  });

  test("is:todo pages through more cards than one batch", async () => {
    const { insert, search } = await setup();
    const url = "https://read.example/oldest";
    await insert({
      content: "oldest to read",
      url,
      metadata: categoryMetadata(url, "article"),
    });
    for (let index = 0; index < 230; index += 1) {
      const noiseUrl = `https://noise.example/${index}`;
      await insert({
        content: `noise ${index}`,
        url: noiseUrl,
        metadata: categoryMetadata(noiseUrl, "repo"),
      });
    }
    const newestUrl = "https://read.example/newest";
    await insert({
      content: "newest to read",
      url: newestUrl,
      metadata: categoryMetadata(newestUrl, "movie"),
    });
    expect(await search("is:todo")).toEqual([
      "newest to read",
      "oldest to read",
    ]);
  });

  test("a smart folder of what is left in Reading list", async () => {
    const { owner, insert, search } = await setup();
    const ids = await seedReading(insert);
    const reading = await owner.mutation(api.folders.createFolder, {
      name: "Reading list",
    });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: reading._id,
      cardIds: [ids.read, ids.unread, ids.repo],
    });
    const left = await owner.mutation(api.folders.createFolder, {
      name: "Left to read",
      kind: "smart",
      query: 'is:todo folder:"Reading list"',
    });
    expect(await search("", { folderId: left._id })).toEqual([
      "Unread article",
    ]);
    expect(await search("is:done", { folderId: left._id })).toEqual([]);
  });

  test("the API's search and scan pages take done and todo", async () => {
    const { t, insert, runScheduled } = await setup();
    await seedReading(insert);
    await runScheduled();
    const contents = (page: { items: { content: string }[] }) =>
      page.items.map((item) => item.content);
    expect(
      contents(
        await t.query(internal.publicApi.scanCardsPageForUser, {
          userId: "owner",
          scanLimit: 50,
          type: "link",
          todo: true,
        })
      )
    ).toEqual(["Film to watch", "Unread article"]);
    expect(
      contents(
        await t.query(internal.publicApi.searchCardsPageForUser, {
          userId: "owner",
          searchQuery: "article",
          type: "link",
          done: true,
        })
      )
    ).toEqual(["Read article"]);
    expect(
      contents(
        await t.query(internal.publicApi.shuffleCardsPageForUser, {
          userId: "owner",
          shuffleSeed: 3,
          limit: 50,
          type: "link",
          todo: true,
        })
      ).sort()
    ).toEqual(["Film to watch", "Unread article"]);
    expect(
      contents(
        await t.query(internal.publicApi.scanCardsPageForUser, {
          userId: "owner",
          scanLimit: 50,
          done: true,
        })
      )
    ).toEqual(["Read article"]);
    const shuffled: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await t.query(internal.publicApi.shuffleCardsPageForUser, {
        userId: "owner",
        shuffleSeed: 3,
        limit: 1,
        cursor,
        type: "link",
        todo: true,
      });
      shuffled.push(...contents(page));
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    expect(shuffled.sort()).toEqual(["Film to watch", "Unread article"]);
  });
});

describe("marking a link done", () => {
  test("done sets completedAt once, undone clears it, and both repeat safely", async () => {
    const { owner, insert, card, search } = await setup();
    const url = "https://read.example/a";
    const cardId = await insert({
      content: "An article",
      url,
      metadata: categoryMetadata(url, "article"),
    });
    vi.setSystemTime(10_000);
    await owner.mutation(api.cards.updateCardField, { cardId, field: "done" });
    expect((await card(cardId))?.completedAt).toBe(10_000);
    vi.setSystemTime(20_000);
    await owner.mutation(api.cards.updateCardField, { cardId, field: "done" });
    expect((await card(cardId))?.completedAt).toBe(10_000);
    expect(await search("is:done")).toEqual(["An article"]);

    await owner.mutation(api.cards.updateCardField, {
      cardId,
      field: "undone",
    });
    expect((await card(cardId))?.completedAt).toBeUndefined();
    await owner.mutation(api.cards.updateCardField, {
      cardId,
      field: "undone",
    });
    expect(await search("is:todo")).toEqual(["An article"]);
  });

  test("the API's done write says whether it changed anything", async () => {
    const { t, insert } = await setup();
    const url = "https://read.example/api";
    const cardId = await insert({
      content: "An article",
      url,
      metadata: categoryMetadata(url, "article"),
    });
    const setDone = async (done: boolean) =>
      (
        await t.mutation(internal.publicApi.cardsForUser.setCardDoneForUser, {
          userId: "owner",
          cardId,
          done,
        })
      )?.changed;
    expect(await setDone(true)).toBe(true);
    expect(await setDone(true)).toBe(false);
    expect(await setDone(false)).toBe(true);
    expect(await setDone(false)).toBe(false);

    const note = await insert({ content: "A note" });
    await expect(
      t.mutation(internal.publicApi.cardsForUser.setCardDoneForUser, {
        userId: "owner",
        cardId: note,
        done: true,
      })
    ).rejects.toThrow("Only link cards");
    const theirs = await insert(
      { content: "Theirs", url: "https://read.example/s" },
      "stranger"
    );
    await expect(
      t.mutation(internal.publicApi.cardsForUser.setCardDoneForUser, {
        userId: "owner",
        cardId: theirs,
        done: true,
      })
    ).rejects.toThrow("Card not found");
  });

  test("refuses notes, cards in Trash, and other people's cards", async () => {
    const { owner, insert } = await setup();
    const note = await insert({ content: "A note" });
    const trashed = await insert({
      content: "Trashed",
      url: "https://read.example/t",
      isDeleted: true,
    });
    const theirs = await insert(
      { content: "Theirs", url: "https://read.example/s" },
      "stranger"
    );
    await expect(
      owner.mutation(api.cards.updateCardField, { cardId: note, field: "done" })
    ).rejects.toThrow("Only link cards");
    await expect(
      owner.mutation(api.cards.updateCardField, {
        cardId: trashed,
        field: "done",
      })
    ).rejects.toThrow("Restore this card");
    await expect(
      owner.mutation(api.cards.updateCardField, {
        cardId: theirs,
        field: "done",
      })
    ).rejects.toThrow("Card not found");
  });
});

describe("listTopSites", () => {
  test("counts recent links by host, most saved first", async () => {
    const { owner, stranger, insert } = await setup();
    await insert({ content: "1", url: "https://github.com/a" });
    await insert({ content: "2", url: "https://www.github.com/b" });
    await insert({ content: "3", url: "https://例え.jp" });
    await insert({
      content: "4",
      url: "https://archived.example",
      isArchived: true,
    });
    await insert({ content: "5", url: "https://other.example" }, "stranger");
    expect(await owner.query(api.cards.listTopSites, {})).toEqual([
      { host: "github.com", label: "github.com", count: 2 },
      { host: "xn--r8jz45g.jp", label: "例え.jp", count: 1 },
    ]);
    expect(await stranger.query(api.cards.listTopSites, { limit: 1 })).toEqual([
      { host: "other.example", label: "other.example", count: 1 },
    ]);
  });
});

describe("backfillUrlHost", () => {
  const seedLegacy = async (t: Awaited<ReturnType<typeof setup>>["t"]) =>
    t.run(async (ctx) => {
      const ids: Id<"cards">[] = [];
      for (const url of [
        "https://www.github.com/a",
        "https://example.com",
        undefined,
        "mailto:x@y.z",
        "https://例え.jp",
      ]) {
        const id = await ctx.db.insert("cards", {
          userId: "owner",
          type: url ? "link" : "text",
          content: "legacy",
          url,
          createdAt: 1,
          updatedAt: 1,
        });
        await syncCardSearchDocumentHandler(ctx, id);
        await ctx.db.patch("cards", id, { urlHost: undefined });
        const document = await ctx.db
          .query("cardSearchDocuments")
          .withIndex("by_cardId", (q) => q.eq("cardId", id))
          .unique();
        if (document) {
          await ctx.db.patch("cardSearchDocuments", document._id, {
            urlHost: undefined,
          });
        }
        ids.push(id);
      }
      return ids;
    });

  test("a dry run reports the changes and writes nothing", async () => {
    const { t, card, runScheduled } = await setup();
    const ids = await seedLegacy(t);
    const result = await t.mutation(
      internal.migration.backfillUrlHost.backfillUrlHost,
      { batchSize: 2 }
    );
    expect(result).toMatchObject({
      dryRun: true,
      isDone: false,
      continuationScheduled: true,
    });
    await runScheduled();
    for (const id of ids) {
      expect((await card(id))?.urlHost).toBeUndefined();
    }
  });

  test("a real run pages from its cursor and sets every host", async () => {
    const { t, card, searchDocument, runScheduled } = await setup();
    const ids = await seedLegacy(t);
    const first = await t.mutation(
      internal.migration.backfillUrlHost.backfillUrlHost,
      { dryRun: false, batchSize: 2, once: true }
    );
    expect(first).toMatchObject({
      isDone: false,
      continuationScheduled: false,
      batch: { examined: 2, cardsToUpdate: 2, searchDocumentsToUpdate: 2 },
    });
    expect((await card(ids[2] as Id<"cards">))?.urlHost).toBeUndefined();
    expect((await card(ids[4] as Id<"cards">))?.urlHost).toBeUndefined();

    const rest = await t.mutation(
      internal.migration.backfillUrlHost.backfillUrlHost,
      { dryRun: false, batchSize: 2, cursor: first.continueCursor }
    );
    expect(rest.continuationScheduled).toBe(true);
    await runScheduled();

    const hosts = await Promise.all(
      ids.map(async (id) => [
        (await card(id))?.urlHost,
        (await searchDocument(id))?.urlHost,
      ])
    );
    expect(hosts).toEqual([
      ["github.com", "github.com"],
      ["example.com", "example.com"],
      [undefined, undefined],
      [undefined, undefined],
      ["xn--r8jz45g.jp", "xn--r8jz45g.jp"],
    ]);

    const again = await t.mutation(
      internal.migration.backfillUrlHost.backfillUrlHost,
      { batchSize: 10, once: true }
    );
    expect(again.batch).toMatchObject({
      examined: 5,
      cardsToUpdate: 0,
      searchDocumentsToUpdate: 0,
    });
  });
});

describe("public API qualifiers", () => {
  test("search and scan pages take the parsed qualifiers", async () => {
    const { t, owner, insert, runScheduled } = await setup();
    await seedLibrary(insert);
    const reading = await owner.mutation(api.folders.createFolder, {
      name: "Reading",
    });
    const filed = await insert({
      content: "Filed GitHub page",
      url: "https://github.com/filed",
    });
    await owner.mutation(api.folders.setCardFolders, {
      cardId: filed,
      folderIds: [reading._id],
    });
    await runScheduled();
    const contents = (page: { items: { content: string }[] }) =>
      page.items.map((item) => item.content);

    expect(
      contents(
        await t.query(internal.publicApi.searchCardsPageForUser, {
          userId: "owner",
          searchQuery: "design system",
          tag: "design",
          type: "link",
          sites: ["github.com"],
          phrases: ["design system"],
        })
      )
    ).toEqual(["Design system on GitHub"]);

    expect(
      contents(
        await t.query(internal.publicApi.searchCardsPageForUser, {
          userId: "owner",
          tag: "design",
          tags: ["writing"],
        })
      )
    ).toEqual(["Blog post about design"]);

    const scan = (args: Record<string, unknown>) =>
      t
        .query(internal.publicApi.scanCardsPageForUser, {
          userId: "owner",
          scanLimit: 50,
          ...args,
        })
        .then(contents);
    expect(await scan({ sites: ["github.com"] })).toEqual([
      "Filed GitHub page",
      "GitHub notes",
      "Design system on GitHub",
    ]);
    expect(await scan({ sites: ["github.com"], archived: "only" })).toEqual([
      "Archived GitHub design",
    ]);
    expect(await scan({ folderNames: ["reading"] })).toEqual([
      "Filed GitHub page",
    ]);
    expect(await scan({ folderNames: ["nope"] })).toEqual([]);
    expect(await scan({ showTrashOnly: true, archivedInTrash: true })).toEqual([
      "Trashed archived design",
    ]);
  });
});

describe("text:", () => {
  const seedImageText = async (
    insert: Awaited<ReturnType<typeof setup>>["insert"]
  ) => {
    await insert({
      content: "Receipt screenshot",
      type: "image",
      aiOcrText: "ACME Market\nInvoice 4411\nTotal due  $12.40",
      ocrCheckedAt: 1,
    });
    await insert({ content: "Note about invoice 4411" });
    await insert({
      content: "Station sign",
      type: "image",
      aiOcrText: "東京駅\nTokyo Station",
      ocrCheckedAt: 1,
    });
    await insert({
      content: "Video title card",
      type: "video",
      aiOcrText: "Episode 4411 trailer",
      ocrCheckedAt: 1,
    });
  };

  test("plain words find image text; text: finds only image text", async () => {
    const { insert, search } = await setup();
    await seedImageText(insert);
    expect((await search("4411")).sort()).toEqual([
      "Note about invoice 4411",
      "Receipt screenshot",
      "Video title card",
    ]);
    expect((await search("text:4411")).sort()).toEqual([
      "Receipt screenshot",
      "Video title card",
    ]);
    expect(await search("text:4411 type:image")).toEqual([
      "Receipt screenshot",
    ]);
    expect(await search("text:東京駅")).toEqual(["Station sign"]);
    expect(await search("text:nothing-here")).toEqual([]);
  });

  test("quoted values match across line breaks; every value must match", async () => {
    const { insert, search } = await setup();
    await seedImageText(insert);
    expect(await search('text:"total due"')).toEqual(["Receipt screenshot"]);
    expect(await search('text:"invoice 4411 total"')).toEqual([
      "Receipt screenshot",
    ]);
    expect(await search("text:invoice text:acme")).toEqual([
      "Receipt screenshot",
    ]);
    expect(await search("text:invoice text:tokyo")).toEqual([]);
  });

  test("plain words beside text: must also match the card", async () => {
    const { insert, search } = await setup();
    await seedImageText(insert);
    expect(await search("receipt text:4411")).toEqual(["Receipt screenshot"]);
    expect(await search("trailer text:4411")).toEqual(["Video title card"]);
    expect(await search("station text:4411")).toEqual([]);
  });

  test("text: keeps to the owner's live, unhidden cards", async () => {
    const { owner, insert, search, stranger } = await setup();
    const trashed = await insert({
      content: "Trashed receipt",
      type: "image",
      aiOcrText: "Invoice 9001",
    });
    await owner.mutation(api.cards.updateCardField, {
      cardId: trashed,
      field: "delete",
    });
    await insert({
      content: "Archived receipt",
      type: "image",
      aiOcrText: "Invoice 9001",
      isArchived: true,
    });
    await insert({
      content: "Secret receipt",
      type: "image",
      aiOcrText: "Invoice 9001",
      tags: ["secret"],
    });
    await insert(
      { content: "Their receipt", type: "image", aiOcrText: "Invoice 9001" },
      "stranger"
    );
    expect(await search("text:9001")).toEqual([]);
    expect(await search("text:9001", { showTrashOnly: true })).toEqual([
      "Trashed receipt",
    ]);
    expect(await search("text:9001 is:archived")).toEqual(["Archived receipt"]);
    expect(await search("text:9001 #secret")).toEqual(["Secret receipt"]);
    expect(await search("text:9001", {}, stranger)).toEqual(["Their receipt"]);
  });

  test("a smart folder's text: joins the typed search", async () => {
    const { owner, insert, search } = await setup();
    await seedImageText(insert);
    const folder = await owner.mutation(api.folders.createFolder, {
      name: "Invoices",
      kind: "smart",
      query: "text:invoice",
    });
    expect(await search("", { folderId: folder._id })).toEqual([
      "Receipt screenshot",
    ]);
    expect(await search("text:tokyo", { folderId: folder._id })).toEqual([]);
  });

  test("refreshing image text resyncs the search document", async () => {
    const { t, insert, search, searchDocument } = await setup();
    const id = await insert({
      content: "Poster",
      type: "image",
      aiOcrText: "Concert 2026",
    });
    expect((await searchDocument(id))?.ocrText).toBe("Concert 2026");
    await t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId: id,
      aiOcrText: "",
      ocrCheckedAt: 2,
    });
    await t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId: id,
      aiSummary: "A poster",
    });
    expect((await searchDocument(id))?.ocrText).toBeUndefined();
    expect(await search("text:concert")).toEqual([]);
    expect(await search("concert")).toEqual([]);
  });

  test("the API's search, scan and shuffle pages take text: values", async () => {
    const { t, insert, runScheduled } = await setup();
    await seedImageText(insert);
    await runScheduled();
    const contents = (page: { items: { content: string }[] }) =>
      page.items.map((item) => item.content).sort();
    const ocrTexts = ["4411"];
    expect(
      contents(
        await t.query(internal.publicApi.searchCardsPageForUser, {
          userId: "owner",
          ocrTexts,
        })
      )
    ).toEqual(["Receipt screenshot", "Video title card"]);
    expect(
      contents(
        await t.query(internal.publicApi.searchCardsPageForUser, {
          userId: "owner",
          searchQuery: "receipt",
          ocrTexts,
        })
      )
    ).toEqual(["Receipt screenshot"]);
    expect(
      contents(
        await t.query(internal.publicApi.scanCardsPageForUser, {
          userId: "owner",
          scanLimit: 50,
          ocrTexts,
        })
      )
    ).toEqual(["Receipt screenshot", "Video title card"]);
    expect(
      contents(
        await t.query(internal.publicApi.shuffleCardsPageForUser, {
          userId: "owner",
          shuffleSeed: 3,
          limit: 50,
          ocrTexts,
        })
      )
    ).toEqual(["Receipt screenshot", "Video title card"]);
  });
});

describe("search operators", () => {
  const live = {
    plain: "Plain design system note",
    example: "Example home",
    blog: "Blog post about design",
    notes: "GitHub notes",
    system: "Design system on GitHub",
  };

  test("the roadmap examples", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    expect(await search("design -github")).toEqual([
      live.plain,
      live.example,
      live.blog,
    ]);
    expect(await search("#design -site:github.com")).toEqual([
      live.plain,
      live.example,
      live.blog,
    ]);
    expect(await search("tag:notes OR tag:writing")).toEqual([
      live.blog,
      live.notes,
    ]);
    expect(
      await search("(site:github.com OR site:example.com) -tag:notes")
    ).toEqual([live.example, live.system]);
    expect(await search("-design")).toEqual([live.notes]);
    expect(await search("type:link -type:link")).toEqual([]);
  });

  test("a tag search reads archived cards an OR asks for", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    expect(await search("tag:design (is:archived OR is:fav)")).toEqual([
      "Archived GitHub design",
      live.blog,
    ]);
  });

  test("words check a document's text, not only the card's own fields", async () => {
    const { t, insert, search, runScheduled } = await setup();
    const pdf = await insert({
      content: "Quarterly report",
      tags: ["reports"],
      hasExtractedText: true,
    });
    await insert({ content: "Team lunch menu", tags: ["reports"] });
    await t.run(async (ctx) => {
      const document = await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) => q.eq("cardId", pdf))
        .unique();
      if (!document) {
        throw new Error("missing search document");
      }
      await ctx.db.patch("cardSearchDocuments", document._id, {
        searchableText: `${document.searchableText}\nStrictly confidential figures`,
      });
    });
    await runScheduled();
    expect(await search("tag:reports -confidential")).toEqual([
      "Team lunch menu",
    ]);
    expect(await search("-confidential tag:reports")).toEqual([
      "Team lunch menu",
    ]);
    expect(await search("tag:nothing OR confidential")).toEqual([
      "Quarterly report",
    ]);
    const scan = await t.query(internal.publicApi.scanCardsPageForUser, {
      userId: "owner",
      scanLimit: 50,
      expression: "-confidential",
      tags: ["reports"],
    });
    expect(scan.items.map((item: { content: string }) => item.content)).toEqual(
      ["Team lunch menu"]
    );
  });

  test("expression text reads stop at the search's read budget", async () => {
    const { t, insert } = await setup();
    const ids: Id<"cards">[] = [];
    for (let index = 0; index < 4; index += 1) {
      // A long transcript that moved off the card.
      ids.push(
        await insert({
          content: `Recording ${index}`,
          aiTranscriptCharCount: 1_000_000,
        })
      );
    }
    await insert({ content: "Plain note" });
    const lengths = await t.run(async (ctx) => {
      for (const id of ids) {
        const document = await ctx.db
          .query("cardSearchDocuments")
          .withIndex("by_cardId", (q) => q.eq("cardId", id))
          .unique();
        if (document) {
          await ctx.db.patch("cardSearchDocuments", document._id, {
            searchableText: "x".repeat(1_000_000),
          });
        }
      }
      const read = expressionTextReader(
        ctx,
        parseSearchQuery("-confidential").expression
      );
      const cards = await ctx.db
        .query("cards")
        .withIndex("by_user_deleted_saved", (q) => q.eq("userId", "owner"))
        .order("asc")
        .collect();
      return Promise.all(
        cards.map(async (card) => (await read(card))?.length ?? null)
      );
    });
    // Two transcripts fit the 2 MiB budget, even read together; then the
    // cards' own fields stand in.
    expect(lengths).toEqual([1_000_000, 1_000_000, null, null, null]);
    const withoutWords = await t.run(async (ctx) => {
      const card = await ctx.db.get("cards", ids[0] as Id<"cards">);
      const read = expressionTextReader(
        ctx,
        parseSearchQuery("-tag:old").expression
      );
      return card ? ((await read(card)) ?? "not read") : "missing";
    });
    expect(withoutWords).toBe("not read");
  });

  test("short file texts take only their length from the read budget", async () => {
    const { t, insert } = await setup();
    for (let index = 0; index < 100; index += 1) {
      await insert({
        content: `Scanned page ${index}`,
        hasExtractedText: true,
        extractedTextCharCount: 2000,
      });
    }
    const read = await t.run(async (ctx) => {
      const reader = expressionTextReader(
        ctx,
        parseSearchQuery("-confidential").expression
      );
      const cards = await ctx.db
        .query("cards")
        .withIndex("by_user_deleted_saved", (q) => q.eq("userId", "owner"))
        .collect();
      const texts = await Promise.all(cards.map((card) => reader(card)));
      return texts.filter((text) => text !== undefined).length;
    });
    // Charged a full 32 KB each, only 64 would fit the 2 MiB budget.
    expect(read).toBe(100);
  });

  test("a top-level word stays required beside an OR group", async () => {
    const { insert, search } = await setup();
    await insert({ content: "alpha and beta" });
    await insert({ content: "alpha kept", tags: ["keep"] });
    await insert({ content: "alpha alone" });
    await insert({ content: "only beta" });
    expect(await search("alpha (tag:keep OR beta)")).toEqual([
      "alpha kept",
      "alpha and beta",
    ]);
  });

  test("a quick command beside an exclusion is a search, not a view", async () => {
    const { insert, search } = await setup();
    await insert({ content: "Fav figma file", isFavorited: true });
    await insert({ content: "Fav sketch file", isFavorited: true });
    expect(await search("fav")).toEqual(["Fav sketch file", "Fav figma file"]);
    expect(await search("fav -figma")).toEqual(["Fav sketch file"]);
  });

  test("a hyphen inside a word is not an exclusion", async () => {
    const { insert, search } = await setup();
    await insert({ content: "A to-do list" });
    await insert({ content: "Groceries" });
    expect(await search("to-do")).toEqual(["A to-do list"]);
  });

  test("archive and trash", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    expect(await search("site:github.com (is:archived OR notes)")).toEqual([
      "Archived GitHub design",
      live.notes,
    ]);
    expect(await search("-is:archived site:github.com")).toEqual([
      live.notes,
      live.system,
    ]);
    expect(
      await search("site:github.com -is:archived", { showTrashOnly: true })
    ).toEqual(["Trashed GitHub design"]);
  });

  test("hidden cards show only through a branch that names their tag", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    await insert({ content: "Private design diary", tags: ["hidden", "x"] });
    expect(await search("-tag:hidden diary")).toEqual([]);
    expect(await search("-tag:hidden")).not.toContain("Private design diary");
    expect(await search("tag:hidden OR tag:writing")).toEqual([
      "Private design diary",
      live.blog,
    ]);
    expect(await search("tag:x OR tag:writing")).toEqual([live.blog]);
    expect(await search("-(tag:hidden OR x) diary")).toEqual([]);
  });

  test("a hidden card needs its whole branch to match, not just its tag", async () => {
    const { t, insert, search } = await setup();
    await insert({ content: "Hidden plain note", tags: ["hidden", "design"] });
    await insert({
      content: "Hidden favorite note",
      tags: ["hidden"],
      isFavorited: true,
    });
    await insert({ content: "Open design note", tags: ["design"] });
    const contents = (page: { items: { content: string }[] }) =>
      page.items.map((item) => item.content);
    const query = "(tag:hidden is:fav) OR tag:design";
    expect(await search(query)).toEqual([
      "Open design note",
      "Hidden favorite note",
    ]);
    expect(
      contents(
        await t.query(internal.publicApi.scanCardsPageForUser, {
          userId: "owner",
          scanLimit: 50,
          expression: query,
        })
      ).sort()
    ).toEqual(["Hidden favorite note", "Open design note"]);
  });

  test("folders resolve inside the expression; an unknown one is just false", async () => {
    const { owner, insert, search } = await setup();
    await seedLibrary(insert);
    const work = await owner.mutation(api.folders.createFolder, {
      name: "Work",
    });
    const filed = await insert({ content: "Filed design brief" });
    await owner.mutation(api.folders.setCardFolders, {
      cardId: filed,
      folderIds: [work._id],
    });
    expect(await search("folder:work OR tag:writing")).toEqual([
      "Filed design brief",
      live.blog,
    ]);
    expect(await search("design -folder:WORK")).not.toContain(
      "Filed design brief"
    );
    expect(await search("folder:nope OR tag:writing")).toEqual([live.blog]);
    expect(await search("tag:notes -folder:nope")).toEqual([live.notes]);
  });

  test("an exclusion pages through more cards than one batch", async () => {
    const { insert, search } = await setup();
    await insert({ content: "oldest keep" });
    for (let index = 0; index < 230; index += 1) {
      await insert({ content: `noise ${index}`, tags: ["noise"] });
    }
    await insert({ content: "newest keep", tags: ["fonts"] });
    expect(await search("-tag:noise")).toEqual(["newest keep", "oldest keep"]);
    expect(await search("tag:fonts OR keep")).toEqual([
      "newest keep",
      "oldest keep",
    ]);
  });

  test("a split page stops at its end cursor, so the client's split ends", async () => {
    const { owner, insert, runScheduled } = await setup();
    for (let index = 0; index < 30; index += 1) {
      await insert({ content: `kept ${index}` });
    }
    await runScheduled();
    const first = await owner.query(api.cards.searchCardsPaginated, {
      paginationOpts: { numItems: 5, cursor: null },
    });
    expect(first.page).toHaveLength(5);
    const page = (endCursor?: string) =>
      owner.query(api.cards.searchCardsPaginated, {
        searchQuery: "-tag:noise",
        paginationOpts: { numItems: 2, cursor: null, endCursor },
      });
    // Without an end, a filtered scan reads a whole batch.
    expect((await page()).page).toHaveLength(30);
    const split = await page(first.continueCursor);
    expect(split.page.map((card: { content: string }) => card.content)).toEqual(
      first.page.map((card: { content: string }) => card.content)
    );
  });

  test("a smart folder's OR and a typed OR intersect", async () => {
    const { owner, insert, search } = await setup();
    await seedLibrary(insert);
    const folder = await owner.mutation(api.folders.createFolder, {
      name: "Design or notes",
      kind: "smart",
      query: "tag:design OR tag:notes",
    });
    expect(folder.query).toBe("tag:design OR tag:notes");
    expect(await search("", { folderId: folder._id })).toEqual([
      live.plain,
      live.example,
      live.blog,
      live.notes,
      live.system,
    ]);
    expect(
      await search("site:github.com OR site:example.com", {
        folderId: folder._id,
      })
    ).toEqual([live.example, live.notes, live.system]);
    expect(await search("-tag:notes", { folderId: folder._id })).toEqual([
      live.plain,
      live.example,
      live.blog,
      live.system,
    ]);
  });

  test("a smart folder checks folders named inside its expression", async () => {
    const { owner } = await setup();
    await expect(
      owner.mutation(api.folders.createFolder, {
        name: "Broken",
        kind: "smart",
        query: "-folder:nope OR x",
      })
    ).rejects.toThrow("No folder named nope");
    const archive = await owner.mutation(api.folders.createFolder, {
      name: "Not archive",
      kind: "smart",
      query: "-archive",
    });
    expect(archive.query).toBe("-archive");
  });

  test("the API's search and scan pages take the expression", async () => {
    const { t, owner, insert, runScheduled } = await setup();
    await seedLibrary(insert);
    const reading = await owner.mutation(api.folders.createFolder, {
      name: "Reading",
    });
    const filed = await insert({ content: "Filed note" });
    await owner.mutation(api.folders.setCardFolders, {
      cardId: filed,
      folderIds: [reading._id],
    });
    await runScheduled();
    const contents = (page: { items: { content: string }[] }) =>
      page.items.map((item) => item.content);
    expect(
      contents(
        await t.query(internal.publicApi.searchCardsPageForUser, {
          userId: "owner",
          searchQuery: "design",
          expression: "-site:github.com",
        })
      )
    ).toEqual([live.plain, live.example, live.blog]);
    const scan = (expression: string, args: Record<string, unknown> = {}) =>
      t
        .query(internal.publicApi.scanCardsPageForUser, {
          userId: "owner",
          scanLimit: 50,
          expression,
          ...args,
        })
        .then(contents);
    expect(await scan("-tag:design")).toEqual(["Filed note", live.notes]);
    expect(await scan("folder:reading OR tag:notes")).toEqual([
      "Filed note",
      live.notes,
    ]);
    expect(
      await scan("tag:notes OR is:archived", { archived: "include" })
    ).toEqual(["Archived GitHub design", live.notes]);
    expect(
      contents(
        await t.query(internal.publicApi.shuffleCardsPageForUser, {
          userId: "owner",
          shuffleSeed: 3,
          limit: 50,
          expression: "-tag:design -filed",
        })
      )
    ).toEqual([live.notes]);
  });
});
