/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  patchCardWithSearchSync,
  syncCardSearchDocumentHandler,
} from "./card/searchDocumentHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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
  workosTest.register(t);
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
    t.mutation(internal.raycast.quickSaveForUser, {
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
    const { cardId } = await t.mutation(internal.raycast.quickSaveForUser, {
      userId: "owner",
      sourceUrl: "https://found-it-here.example",
      url: "https://github.com/acme",
    });
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
    // A text card with a price in its metadata is still not a product.
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
    // A malformed bound is a word no card holds.
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
