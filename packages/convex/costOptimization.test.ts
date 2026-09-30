/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  patchCardWithSearchSync,
  searchCardsByExactTag,
  syncCardSearchDocumentHandler,
  syncCardSearchTagsBatchHandler,
} from "./card/searchDocumentHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function drainTags(ctx: MutationCtx, cardId: Id<"cards">) {
  for (let i = 0; i < 10; i++) {
    if ((await syncCardSearchTagsBatchHandler(ctx, cardId)).complete) {
      return;
    }
  }
  throw new Error("Tag synchronization did not finish");
}

async function seed(ctx: MutationCtx) {
  const cardId = await ctx.db.insert("cards", {
    userId: "cost-test",
    type: "text",
    content: "original text",
    tags: ["alpha"],
    createdAt: 10,
    updatedAt: 10,
  });
  await syncCardSearchDocumentHandler(ctx, cardId);
  await drainTags(ctx, cardId);
  return cardId;
}

async function searchState(ctx: MutationCtx, cardId: Id<"cards">) {
  return {
    document: await ctx.db
      .query("cardSearchDocuments")
      .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
      .unique(),
    tags: await ctx.db
      .query("cardSearchTags")
      .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
      .collect(),
    sync: await ctx.db
      .query("cardSearchTagSyncStates")
      .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
      .unique(),
  };
}

test("operational card updates preserve search rows and customer content", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await seed(ctx);
    const before = await searchState(ctx, id);
    await patchCardWithSearchSync(ctx, id, {
      updatedAt: 20,
      metadataStatus: "completed",
      thumbnailKey: "thumbnail",
    });
    expect(await searchState(ctx, id)).toEqual(before);
    expect(await ctx.db.get("cards", id)).toMatchObject({
      content: "original text",
      tags: ["alpha"],
      updatedAt: 20,
    });
    // Old already-scheduled invocations must also remain no-ops.
    await syncCardSearchDocumentHandler(ctx, id);
    expect(await searchState(ctx, id)).toEqual(before);
  });
});

test("content edits update full text without restarting unchanged exact tags", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await seed(ctx);
    const before = await searchState(ctx, id);
    await patchCardWithSearchSync(ctx, id, {
      content: "new words",
      updatedAt: 20,
    });
    const after = await searchState(ctx, id);
    expect(after.document?.searchableText).toContain("new words");
    expect(after.document?.sourceUpdatedAt).toBe(20);
    expect(after.tags).toEqual(before.tags);
    expect(after.sync).toEqual(before.sync);
  });
});

test("tag edits and favorite changes remain searchable with the right filters", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await seed(ctx);
    await patchCardWithSearchSync(ctx, id, {
      tags: ["beta"],
      isFavorited: true,
      updatedAt: 20,
    });
    await drainTags(ctx, id);
    const rows = await searchCardsByExactTag(ctx, {
      userId: "cost-test",
      tag: "beta",
      limit: 10,
      isFavorited: true,
      sort: "newest",
    });
    expect(rows.map((card) => card._id)).toEqual([id]);
    expect(
      await searchCardsByExactTag(ctx, {
        userId: "cost-test",
        tag: "alpha",
        limit: 10,
        sort: "newest",
      })
    ).toEqual([]);
    expect((await ctx.db.get("cards", id))?.content).toBe("original text");
  });
});

test("reordered normalized tags preserve exact-tag rows and generations", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await seed(ctx);
    await patchCardWithSearchSync(ctx, id, { tags: ["alpha", "beta"] });
    await drainTags(ctx, id);
    const before = await searchState(ctx, id);
    await patchCardWithSearchSync(ctx, id, {
      tags: [" Beta ", "ALPHA"],
      updatedAt: 30,
    });
    const after = await searchState(ctx, id);
    expect(after.tags).toEqual(before.tags);
    expect(after.sync).toEqual(before.sync);
    for (const tag of ["alpha", "beta"]) {
      expect(
        (
          await searchCardsByExactTag(ctx, {
            userId: "cost-test",
            tag,
            limit: 10,
            sort: "newest",
          })
        ).map((card) => card._id)
      ).toEqual([id]);
    }
  });
});
