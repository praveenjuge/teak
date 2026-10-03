/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import {
  searchCardsByDocument,
  searchCardsByExactTag,
  syncCardSearchDocumentHandler,
  syncCardSearchTagsBatchHandler,
} from "./card/searchDocumentHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workflowTest.register(t);
  const cardId = await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "owner",
      type: "link",
      content: "Original content",
      url: "https://example.com",
      metadataTitle: "Supersededtitle title",
      notes: "Original notes",
      tags: ["original"],
      createdAt: 1,
      updatedAt: 1,
    })
  );
  return { t, cardId };
}

describe("Public API card title editing", () => {
  test("persists a trimmed title while preserving content and other card fields", async () => {
    const { t, cardId } = await setup();
    const updated = await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      metadataTitle: "  Edited title  ",
    });
    expect(updated?.metadataTitle).toBe("Edited title");
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card).toMatchObject({
      metadataTitle: "Edited title",
      content: "Original content",
      notes: "Original notes",
      tags: ["original"],
      url: "https://example.com",
    });
    expect(card?.updatedAt).toBeGreaterThan(1);
    expect(card?.processingStatus).toBeUndefined();
    const found = await t.query(internal.raycast.searchCardsForUser, {
      userId: "owner",
      searchQuery: "Edited",
    });
    expect(found).toHaveLength(1);
    expect(found[0]?._id).toBe(cardId);
    const oldTitle = await t.query(internal.raycast.searchCardsForUser, {
      userId: "owner",
      searchQuery: "Supersededtitle",
    });
    expect(oldTitle).toHaveLength(0);
  });

  test.each([null, "", "  "])(
    "clears a title with %j",
    async (metadataTitle) => {
      const { t, cardId } = await setup();
      await t.mutation(internal.raycast.patchCardForUser, {
        cardId,
        userId: "owner",
        metadataTitle,
      });
      const card = await t.run((ctx) => ctx.db.get("cards", cardId));
      expect(card?.metadataTitle).toBeUndefined();
      expect(card?.content).toBe("Original content");
    }
  );

  test.each(["text", "quote"] as const)(
    "edits %s content and title together",
    async (type) => {
      const { t, cardId } = await setup();
      await t.run((ctx) => ctx.db.patch("cards", cardId, { type }));
      const updated = await t.mutation(internal.raycast.patchCardForUser, {
        cardId,
        userId: "owner",
        content: "Updated content",
        metadataTitle: "Edited title",
      });
      expect(updated?.metadataTitle).toBe("Edited title");
      expect(updated?.content).toBe("Updated content");
      const card = await t.run((ctx) => ctx.db.get("cards", cardId));
      expect(card?.metadataTitle).toBe("Edited title");
      expect(card?.content).toBe("Updated content");
    }
  );

  test.each(["Custom title", null])(
    "preview refresh preserves explicit title %j",
    async (metadataTitle) => {
      const { t, cardId } = await setup();
      await t.mutation(internal.raycast.patchCardForUser, {
        cardId,
        userId: "owner",
        metadataTitle,
      });
      await t.mutation(internal.linkMetadata.updateCardMetadata, {
        cardId,
        status: "completed",
        linkPreview: { status: "success", title: "Refreshed page title" },
      });
      const card = await t.run((ctx) => ctx.db.get("cards", cardId));
      expect(card?.metadataTitle).toBe(metadataTitle ?? undefined);
      expect(card?.metadata?.linkPreview?.title).toBe("Refreshed page title");
    }
  );

  test("preview refresh still updates untouched legacy titles", async () => {
    const { t, cardId } = await setup();
    await t.mutation(internal.linkMetadata.updateCardMetadata, {
      cardId,
      status: "completed",
      linkPreview: { status: "success", title: "Refreshed page title" },
    });
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.metadataTitle).toBe("Refreshed page title");
  });

  test("old clients can edit notes without changing the title", async () => {
    const { t, cardId } = await setup();
    const updated = await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      notes: "Updated notes",
    });
    expect(updated?.notes).toBe("Updated notes");
    expect(updated?.metadataTitle).toBe("Supersededtitle title");
  });

  test("accepts the title length boundary and rejects oversized titles atomically", async () => {
    const { t, cardId } = await setup();
    await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      metadataTitle: "x".repeat(512),
    });
    await expect(
      t.mutation(internal.raycast.patchCardForUser, {
        cardId,
        userId: "owner",
        metadataTitle: "x".repeat(513),
        notes: "Must not persist",
      })
    ).rejects.toThrow("Title must be a string of at most 512 characters");
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.metadataTitle).toHaveLength(512);
    expect(card?.notes).toBe("Original notes");
  });

  test("another user cannot edit a card title", async () => {
    const { t, cardId } = await setup();
    await expect(
      t.mutation(internal.raycast.patchCardForUser, {
        cardId,
        userId: "stranger",
        metadataTitle: "Unwanted edit",
      })
    ).rejects.toThrow("Not authorized");
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.metadataTitle).toBe("Supersededtitle title");
  });
});

describe("Public API Trash and visual filters", () => {
  test("filters Trash and image facets without exposing other users", async () => {
    const { t, cardId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch("cards", cardId, {
        type: "image",
        isDeleted: true,
        visualStyles: ["minimal"],
        colorHues: ["blue"],
        colorHexes: ["#112233"],
      });
      await ctx.db.insert("cards", {
        userId: "stranger",
        type: "image",
        content: "Other user",
        isDeleted: true,
        visualStyles: ["minimal"],
        colorHues: ["blue"],
        colorHexes: ["#112233"],
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const page = await t.query(internal.publicApi.scanCardsPageForUser, {
      userId: "owner",
      showTrashOnly: true,
      styleFilters: ["minimal"],
      hueFilters: ["blue"],
      hexFilters: ["#112233"],
      scanLimit: 50,
    });
    expect(page.items.map((card: { _id: string }) => card._id)).toEqual([
      cardId,
    ]);
    const active = await t.query(internal.publicApi.scanCardsPageForUser, {
      userId: "owner",
      scanLimit: 50,
    });
    expect(active.items).toEqual([]);
    const mismatch = await t.query(internal.publicApi.scanCardsPageForUser, {
      userId: "owner",
      showTrashOnly: true,
      hueFilters: ["red"],
      scanLimit: 50,
    });
    expect(mismatch.items).toEqual([]);
  });

  test.each(["text", "tag"])(
    "finds visual matches beyond initial %s search candidates",
    async (source) => {
      const { t } = await setup();
      const matches = await t.run(async (ctx) => {
        const ids: string[] = [];
        for (let index = 0; index < 455; index += 1) {
          const isMatch = index < 3;
          const id = await ctx.db.insert("cards", {
            userId: "owner",
            type: "image",
            content: "coastal inspiration",
            tags: ["coastal"],
            visualStyles: [isMatch ? "minimal" : "vibrant"],
            createdAt: index + 2,
            updatedAt: index + 2,
          });
          await syncCardSearchDocumentHandler(ctx, id);
          await syncCardSearchTagsBatchHandler(ctx, id);
          if (isMatch) {
            ids.unshift(id);
          }
        }
        return ids;
      });
      const options = {
        userId: "owner",
        types: ["image", "video", "audio", "text"] as (
          | "image"
          | "video"
          | "audio"
          | "text"
        )[],
        styleFilters: ["minimal"],
        limit: 2,
        ...(source === "text"
          ? { searchQuery: "coastal" }
          : { tag: "coastal" }),
      };
      const first = await t.query(
        internal.publicApi.searchCardsPageForUser,
        options
      );
      expect(first.items.map((card: { _id: string }) => card._id)).toEqual(
        matches.slice(0, 2)
      );
      expect(first.pageInfo.hasMore).toBe(true);
      const second = await t.query(internal.publicApi.searchCardsPageForUser, {
        ...options,
        cursor: first.pageInfo.nextCursor ?? undefined,
      });
      expect(second.items.map((card: { _id: string }) => card._id)).toEqual(
        matches.slice(2)
      );
      expect(second.pageInfo.hasMore).toBe(false);
    }
  );

  test("repeated restore preserves the already active card", async () => {
    const { t, cardId } = await setup();
    await t.run((ctx) => ctx.db.patch("cards", cardId, { isDeleted: true }));
    await t.mutation(internal["card/deleteCard"].restoreCardForUser, {
      userId: "owner",
      cardId,
    });
    const first = await t.run((ctx) => ctx.db.get("cards", cardId));
    await t.mutation(internal["card/deleteCard"].restoreCardForUser, {
      userId: "owner",
      cardId,
    });
    expect(await t.run((ctx) => ctx.db.get("cards", cardId))).toEqual(first);
    await expect(
      t.mutation(internal["card/deleteCard"].restoreCardForUser, {
        userId: "stranger",
        cardId,
      })
    ).rejects.toThrow("Not authorized");
  });

  test("restores and permanently deletes only the owner's card", async () => {
    const { t, cardId } = await setup();
    await t.run((ctx) => ctx.db.patch("cards", cardId, { isDeleted: true }));
    await expect(
      t.mutation(internal["card/deleteCard"].restoreCardForUser, {
        userId: "stranger",
        cardId,
      })
    ).rejects.toThrow("Not authorized");
    await t.mutation(internal["card/deleteCard"].restoreCardForUser, {
      userId: "owner",
      cardId,
    });
    expect(
      (await t.run((ctx) => ctx.db.get("cards", cardId)))?.isDeleted
    ).toBeUndefined();
    await expect(
      t.mutation(internal["card/deleteCard"].permanentDeleteCardForUser, {
        userId: "stranger",
        cardId,
      })
    ).rejects.toThrow("Not authorized");
    await t.mutation(internal["card/deleteCard"].permanentDeleteCardForUser, {
      userId: "owner",
      cardId,
    });
    expect(await t.run((ctx) => ctx.db.get("cards", cardId))).toBeNull();
  });
});

describe("Search scan budget", () => {
  test.each(["tag", "text"])(
    "%s search allows an exhausted budget and rejects another index row",
    async (mode) => {
      const { t, cardId } = await setup();
      await t.run(async (ctx) => {
        await syncCardSearchTagsBatchHandler(ctx, cardId);
        await syncCardSearchDocumentHandler(ctx, cardId);
      });
      const search = () =>
        t.run((ctx) =>
          (mode === "tag" ? searchCardsByExactTag : searchCardsByDocument)(
            ctx,
            {
              userId: "owner",
              tag: "original",
              searchQuery: "Original",
              limit: 10,
              sort: "newest",
              scanBudget: { remaining: 1 },
              resultFilter: () => false,
            }
          )
        );
      if (mode === "tag") {
        expect(await search()).toEqual([]);
      } else {
        await expect(search()).rejects.toThrow("Search is too broad");
      }
      await t.run(async (ctx) => {
        const second = await ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content: "Original second",
          tags: ["original"],
          createdAt: 2,
          updatedAt: 2,
        });
        await syncCardSearchTagsBatchHandler(ctx, second);
        await syncCardSearchDocumentHandler(ctx, second);
      });
      await expect(search()).rejects.toThrow("Search is too broad");
    }
  );
});
