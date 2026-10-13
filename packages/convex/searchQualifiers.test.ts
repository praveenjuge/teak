/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
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
  workflowTest.register(t);
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

  // Every page of a search, newest first unless args say otherwise, once
  // the tag rows have caught up.
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

describe("search qualifiers", () => {
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

  test("site: matches the exact host however it is written", async () => {
    const { insert, search } = await setup();
    await seedLibrary(insert);
    const github = ["GitHub notes", "Design system on GitHub"];
    expect(await search("site:github.com")).toEqual(github);
    expect(await search("site:WWW.GITHUB.COM")).toEqual(github);
    expect(await search("site:https://github.com/anything")).toEqual(github);
    // Subdomains are separate sites.
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
    // A type outside the view's types matches nothing.
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
    // Archived cards stay out of the library without is:archived.
    expect(await search("site:github.com")).not.toContain(
      "Archived GitHub design"
    );
    // In Trash, is:archived keeps the trashed cards that were archived.
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
    expect(await search("folder:nope")).toEqual([]);
    expect(await search("folder:secret")).toEqual([]);
    // Another user's name in my search does not reach their folder.
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
    // Several sites read the library list in batches and filter each one.
    expect(await search("site:a.example site:b.example")).toEqual([
      "newest match",
      "oldest match",
    ]);
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
        // Cards saved before urlHost existed.
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

    // A second run finds nothing to change.
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
