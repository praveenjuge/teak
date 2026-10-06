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
import { updateCardFieldForUserHandler } from "./card/updateCard";
import schema from "./schema";
import type { TeakUserId } from "./securitySessions";

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

test("text-only patches do not read tag-chain state while a batch is pending", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("cards", {
      userId: "text-occ",
      type: "text",
      content: "before",
      tags: ["alpha"],
      createdAt: 10,
      updatedAt: 10,
    });
    await syncCardSearchDocumentHandler(ctx, id);
    const originalQuery = ctx.db.query.bind(ctx.db);
    const guarded = {
      ...ctx,
      db: new Proxy(ctx.db, {
        get(target, key) {
          if (key === "query")
            return (table: string) => {
              if (table === "cardSearchTagSyncStates")
                throw new Error("text patch read tag progress");
              return originalQuery(table as any);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    } as MutationCtx;
    await patchCardWithSearchSync(guarded, id, {
      content: "new words",
      updatedAt: 20,
    });
    await patchCardWithSearchSync(guarded, id, {
      aiSummary: "new summary",
      updatedAt: 30,
    });
    const state = await ctx.db
      .query("cardSearchTagSyncStates")
      .withIndex("by_cardId", (q) => q.eq("cardId", id))
      .unique();
    expect(state?.generation).toBe(1);
    expect(state?.pending).toBe(true);
    await drainTags(ctx, id);
    expect((await searchState(ctx, id)).document?.searchableText).toContain(
      "new summary"
    );
    expect((await searchState(ctx, id)).tags.map((x) => x.tag)).toEqual([
      "alpha",
    ]);
  });
});

test("missing search documents and direct sync still repair tag state", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await seed(ctx);
    const before = await searchState(ctx, id);
    await ctx.db.delete("cardSearchDocuments", before.document!._id);
    await ctx.db.delete("cardSearchTagSyncStates", before.sync!._id);
    await patchCardWithSearchSync(ctx, id, {
      content: "repair missing document",
      updatedAt: 20,
    });
    expect((await searchState(ctx, id)).sync?.pending).toBe(true);
    await drainTags(ctx, id);
    const repaired = await searchState(ctx, id);
    await ctx.db.delete("cardSearchTagSyncStates", repaired.sync!._id);
    await syncCardSearchDocumentHandler(ctx, id);
    expect((await searchState(ctx, id)).sync?.pending).toBe(true);
  });
});

test("field updates avoid tag progress reads and still repair a missing state on direct sync", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("cards", {
      userId: "field-occ",
      type: "text",
      content: "before",
      tags: ["alpha"],
      createdAt: 10,
      updatedAt: 10,
    });
    await syncCardSearchDocumentHandler(ctx, id);
    const originalQuery = ctx.db.query.bind(ctx.db);
    const guarded = {
      ...ctx,
      db: new Proxy(ctx.db, {
        get(target, key) {
          if (key === "query")
            return (table: string) => {
              if (table === "cardSearchTagSyncStates")
                throw new Error("field update read tag progress");
              return originalQuery(table as any);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    } as MutationCtx;
    await updateCardFieldForUserHandler(guarded, {
      userId: "field-occ" as TeakUserId,
      cardId: id,
      field: "notes",
      value: "a note",
    });
    expect((await ctx.db.get("cards", id))?.notes).toBe("a note");
    expect((await searchState(ctx, id)).sync?.generation).toBe(1);
    // Existing document with a missing state row: a direct sync repairs it.
    const state = await searchState(ctx, id);
    await ctx.db.delete("cardSearchTagSyncStates", state.sync!._id);
    await syncCardSearchDocumentHandler(ctx, id);
    expect((await searchState(ctx, id)).sync?.pending).toBe(true);
  });
});
