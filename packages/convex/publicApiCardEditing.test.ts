import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  searchCardsByDocument,
  searchCardsByExactTag,
  syncCardSearchDocumentHandler,
  syncCardSearchTagsBatchHandler,
} from "./card/searchDocumentHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// Load the storage SDK before timing behavior assertions. Convex-test lazily
// imports function modules, so the first restore otherwise includes this cost.
beforeAll(async () => {
  await import("./card/deleteCard");
});

async function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  await seedWorkosOwner(t, "owner");
  await seedWorkosOwner(t, "stranger");
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

  test("cuts an oversized title to 512 characters and keeps the other edits", async () => {
    const { t, cardId } = await setup();
    await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      metadataTitle: "x".repeat(600),
      notes: "Saved with the title",
    });
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.metadataTitle).toBe("x".repeat(512));
    expect(card?.notes).toBe("Saved with the title");
  });

  test("another user cannot edit a card title", async () => {
    const { t, cardId } = await setup();
    await expect(
      t.mutation(internal.raycast.patchCardForUser, {
        cardId,
        userId: "stranger",
        metadataTitle: "Unwanted edit",
      })
    ).rejects.toThrow("Card not found");
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
    await expect(
      t.mutation(internal["card/deleteCard"].permanentDeleteCardForUser, {
        userId: "owner",
        cardId,
      })
    ).rejects.toThrow("NOT_IN_TRASH");
    await t.mutation(internal.raycast.softDeleteCardForUser, {
      userId: "owner",
      cardId,
    });
    await t.mutation(internal["card/deleteCard"].permanentDeleteCardForUser, {
      userId: "owner",
      cardId,
    });
    expect(await t.run((ctx) => ctx.db.get("cards", cardId))).toBeNull();
  });
});

describe("Search scan budget", () => {
  test("multi-type tag search shares the total read budget", async () => {
    const { t } = await setup();
    const types = ["text", "image", "video", "audio"] as const;
    await t.run(async (ctx) => {
      for (let index = 0; index < 4100; index += 1) {
        const id = await ctx.db.insert("cards", {
          userId: "owner",
          type: types[index % types.length],
          content: "Shared budget",
          tags: ["budget"],
          visualStyles: ["vibrant"],
          createdAt: index + 2,
          updatedAt: index + 2,
        });
        await ctx.db.insert("cardSearchTags", {
          cardId: id,
          userId: "owner",
          tag: "budget",
          type: types[index % types.length],
          cardCreatedAt: index + 2,
          sourceUpdatedAt: index + 2,
          syncGeneration: 1,
        });
      }
    });
    await expect(
      t.query(internal.publicApi.searchCardsPageForUser, {
        userId: "owner",
        tag: "budget",
        types: [...types],
        styleFilters: ["minimal"],
        limit: 1,
      })
    ).rejects.toThrow("Search is too broad");
  }, 30_000);

  test("a saturated text search still serves deep pages without post-filters", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 1024; index += 1) {
        const id = await ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content: "deepsearch inspiration",
          createdAt: index + 2,
          updatedAt: index + 2,
        });
        await syncCardSearchDocumentHandler(ctx, id);
      }
    });
    const found = await t.run((ctx) =>
      searchCardsByDocument(ctx, {
        userId: "owner",
        searchQuery: "deepsearch",
        limit: 1204,
      })
    );
    expect(found).toHaveLength(1024);
    await expect(
      t.query(internal.publicApi.searchCardsPageForUser, {
        userId: "owner",
        searchQuery: "deepsearch",
        limit: 100,
        cursor: btoa(JSON.stringify({ mode: "offset", offset: 200 })),
      })
    ).rejects.toThrow("Query parameter `cursor` is invalid");

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const next = await t.query(internal.publicApi.searchCardsPageForUser, {
        userId: "owner",
        searchQuery: "deepsearch",
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...next.items.map((item: { _id: string }) => item._id));
      if (!next.pageInfo.hasMore) {
        break;
      }
      cursor = next.pageInfo.nextCursor ?? undefined;
    }
    expect(seen).toHaveLength(400);
    expect(new Set(seen).size).toBe(400);
  }, 60_000);

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

  test("tag search across archive states counts rows of other types", async () => {
    const { t, cardId } = await setup();
    await t.run(async (ctx) => {
      const second = await ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: "Original second",
        tags: ["original"],
        createdAt: 2,
        updatedAt: 2,
      });
      await syncCardSearchTagsBatchHandler(ctx, cardId);
      await syncCardSearchTagsBatchHandler(ctx, second);
    });
    const search = (remaining: number) =>
      t.run((ctx) =>
        searchCardsByExactTag(ctx, {
          userId: "owner",
          tag: "original",
          archived: "include",
          type: "image",
          limit: 10,
          sort: "newest",
          scanBudget: { remaining },
        })
      );
    expect(await search(2)).toEqual([]);
    await expect(search(1)).rejects.toThrow("Search is too broad");
  });
});

describe("Public API AI tag removal", () => {
  test("removes only the named AI tags and keeps the card's own tags", async () => {
    const { t, cardId } = await setup();
    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, { aiTags: ["design", "color", "web"] })
    );
    const updated = await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      removeAiTags: ["color", "missing"],
    });
    expect(updated?.aiTags).toEqual(["design", "web"]);
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card).toMatchObject({
      aiTags: ["design", "web"],
      tags: ["original"],
    });
  });

  test("refuses to touch another user's card", async () => {
    const { t, cardId } = await setup();
    await t.run((ctx) => ctx.db.patch("cards", cardId, { aiTags: ["design"] }));
    await expect(
      t.mutation(internal.raycast.patchCardForUser, {
        cardId,
        userId: "stranger",
        removeAiTags: ["design"],
      })
    ).rejects.toThrow();
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.aiTags).toEqual(["design"]);
  });
});

const scheduledWorkflowStarts = (t: Awaited<ReturnType<typeof setup>>["t"]) =>
  t.run(async (ctx) =>
    (await ctx.db.query("workflowDispatches").collect()).filter(
      (row) => row.kind === "cardProcessing"
    )
  );

describe("Multi-field edits", () => {
  test("rapid edits always save and share one waiting pipeline run", async () => {
    const { t, cardId } = await setup();
    const now = Date.now();
    await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      content: "Fresh content",
      url: "https://example.org/fresh",
    });
    const second = await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      content: "Second edit",
    });
    expect(second?.content).toBe("Second edit");
    const third = await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      content: "Third edit",
    });
    expect(third?.content).toBe("Third edit");

    const jobs = await scheduledWorkflowStarts(t);
    expect(jobs.map((job) => job.notBefore - now)).toEqual([0, 60_000]);
    expect(jobs.every((job) => job.reset === true)).toBe(true);
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.content).toBe("Third edit");
    expect(card?.processingRev).toBe(jobs[jobs.length - 1]?.rev);
  });

  test("a bulk edit refused by the account cap leaves the card's next edit a run", async () => {
    const { t, cardId } = await setup();
    await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      content: "First edit",
    });
    for (let index = 0; index < 11; index += 1) {
      const otherId = await t.run((ctx) =>
        ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content: `Card ${index}`,
          createdAt: index,
          updatedAt: index,
        })
      );
      await t.mutation(internal.raycast.patchCardForUser, {
        cardId: otherId,
        userId: "owner",
        content: `Edited ${index}`,
      });
    }
    const result = await t.mutation(
      internal.publicApi.executeBulkCardsForUser,
      {
        userId: "owner",
        operation: "update",
        items: [{ cardId, content: "Bulk edit" }],
      }
    );
    expect(result.summary.failed).toBe(1);

    vi.advanceTimersByTime(11_000);
    await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      content: "Later edit",
    });
    const cardJobs = (await scheduledWorkflowStarts(t)).filter(
      (job) => job.cardId === cardId
    );
    expect(cardJobs).toHaveLength(2);
  });

  test("bulk update applies content and url together", async () => {
    const { t, cardId } = await setup();
    const result = await t.mutation(
      internal.publicApi.executeBulkCardsForUser,
      {
        userId: "owner",
        operation: "update",
        items: [
          { cardId, content: "Bulk content", url: "https://example.org/bulk" },
        ],
      }
    );
    expect(result.summary).toEqual({ total: 1, succeeded: 1, failed: 0 });
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card).toMatchObject({
      content: "Bulk content",
      url: "https://example.org/bulk",
    });
  });

  test("a rejected bulk item writes nothing and keeps the reprocess token", async () => {
    const { t, cardId } = await setup();
    const result = await t.mutation(
      internal.publicApi.executeBulkCardsForUser,
      {
        userId: "owner",
        operation: "update",
        items: [{ cardId, content: "Must not persist", url: "javascript:x" }],
      }
    );
    expect(result.summary.failed).toBe(1);
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.content).toBe("Original content");
    expect(card?.url).toBe("https://example.com");
    const updated = await t.mutation(internal.raycast.patchCardForUser, {
      cardId,
      userId: "owner",
      content: "Allowed edit",
    });
    expect(updated?.content).toBe("Allowed edit");
  });
});

describe("Refresh details", () => {
  test("queues the processing workflow for the owner's card", async () => {
    const { t, cardId } = await setup();
    const result = await t.mutation(
      internal["card/updateCard"].reprocessCardForUser,
      { cardId, userId: "owner" }
    );
    expect(result.cardId).toBe(cardId);
    const jobs = await scheduledWorkflowStarts(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      cardId,
      params: { refresh: true },
      reset: true,
      state: "pending",
    });
  });

  test("a second run on the same card within a minute is refused with retryAt", async () => {
    const { t, cardId } = await setup();
    await t.mutation(internal["card/updateCard"].reprocessCardForUser, {
      cardId,
      userId: "owner",
    });
    const error = await t
      .mutation(internal["card/updateCard"].reprocessCardForUser, {
        cardId,
        userId: "owner",
      })
      .catch((caught: unknown) => caught);
    expect(String(error)).toContain("RATE_LIMITED");
    expect(String(error)).toContain("already refreshing");
    expect(String(error)).toContain("retryAt");
    expect(await scheduledWorkflowStarts(t)).toHaveLength(1);
  });

  test("refuses after six cards in a minute", async () => {
    const { t } = await setup();
    const cardIds: Id<"cards">[] = [];
    for (let index = 0; index < 7; index += 1) {
      cardIds.push(
        await t.run((ctx) =>
          ctx.db.insert("cards", {
            userId: "owner",
            type: "text",
            content: `Card ${index}`,
            createdAt: index,
            updatedAt: index,
          })
        )
      );
    }
    for (const cardId of cardIds.slice(0, 6)) {
      await t.mutation(internal["card/updateCard"].reprocessCardForUser, {
        cardId,
        userId: "owner",
      });
    }
    await expect(
      t.mutation(internal["card/updateCard"].reprocessCardForUser, {
        cardId: cardIds[6] as Id<"cards">,
        userId: "owner",
      })
    ).rejects.toThrow("refreshed a lot of cards");
    expect(await scheduledWorkflowStarts(t)).toHaveLength(6);
  });

  test("refuses another user's card without spending the owner's limit", async () => {
    const { t, cardId } = await setup();
    await expect(
      t.mutation(internal["card/updateCard"].reprocessCardForUser, {
        cardId,
        userId: "stranger",
      })
    ).rejects.toThrow("Card not found");
    expect(await scheduledWorkflowStarts(t)).toHaveLength(0);
    await t.mutation(internal["card/updateCard"].reprocessCardForUser, {
      cardId,
      userId: "owner",
    });
    expect(await scheduledWorkflowStarts(t)).toHaveLength(1);
  });

  test("the app's mutation returns a refusal instead of throwing", async () => {
    const { t, cardId } = await setup();
    const owner = t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject: `user_${Buffer.from("owner").toString("hex")}`,
      sid: "session_rerun",
      email_verified: true,
      external_id: "owner",
    });
    expect(
      await owner.mutation(api.cards.reprocessCard, { cardId })
    ).toMatchObject({ status: "queued", cardId });
    const refused = await owner.mutation(api.cards.reprocessCard, { cardId });
    expect(refused).toMatchObject({
      status: "refused",
      code: "RATE_LIMITED",
      message: "This card is already refreshing. Try again in a minute.",
    });
    expect(
      refused.status === "refused" ? refused.retryAt : undefined
    ).toBeGreaterThan(Date.now());
    expect(await scheduledWorkflowStarts(t)).toHaveLength(1);
  });

  test("an account-wide refusal leaves the card's own minute unspent", async () => {
    const { t } = await setup();
    const cardIds: Id<"cards">[] = [];
    for (let index = 0; index < 7; index += 1) {
      cardIds.push(
        await t.run((ctx) =>
          ctx.db.insert("cards", {
            userId: "owner",
            type: "text",
            content: `Card ${index}`,
            createdAt: index,
            updatedAt: index,
          })
        )
      );
    }
    for (const cardId of cardIds.slice(0, 6)) {
      await t.mutation(internal["card/updateCard"].reprocessCardForUser, {
        cardId,
        userId: "owner",
      });
    }
    const last = cardIds[6] as Id<"cards">;
    const owner = t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject: `user_${Buffer.from("owner").toString("hex")}`,
      sid: "session_rerun",
      email_verified: true,
      external_id: "owner",
    });
    expect(
      await owner.mutation(api.cards.reprocessCard, { cardId: last })
    ).toMatchObject({ status: "refused", code: "RATE_LIMITED" });
    vi.advanceTimersByTime(11_000);
    expect(
      await owner.mutation(api.cards.reprocessCard, { cardId: last })
    ).toMatchObject({ status: "queued" });
    expect(await scheduledWorkflowStarts(t)).toHaveLength(7);
  });

  test("asks to restore a card in Trash first", async () => {
    const { t, cardId } = await setup();
    await t.mutation(internal.raycast.softDeleteCardForUser, {
      userId: "owner",
      cardId,
    });
    await expect(
      t.mutation(internal["card/updateCard"].reprocessCardForUser, {
        cardId,
        userId: "owner",
      })
    ).rejects.toThrow("Restore this card from Trash");
    expect(await scheduledWorkflowStarts(t)).toHaveLength(0);
  });
});

describe("Card changes feed", () => {
  const trashAndPurge = async (
    t: Awaited<ReturnType<typeof setup>>["t"],
    cardId: Awaited<ReturnType<typeof setup>>["cardId"]
  ) => {
    await t.mutation(internal.raycast.softDeleteCardForUser, {
      userId: "owner",
      cardId,
    });
    await t.mutation(internal["card/deleteCard"].permanentDeleteCardForUser, {
      userId: "owner",
      cardId,
    });
  };

  test("reports a permanently deleted card", async () => {
    const { t, cardId } = await setup();
    await trashAndPurge(t, cardId);
    const changes = await t.query(internal.publicApi.listCardChangesForUser, {
      userId: "owner",
      since: 0,
    });
    expect(changes.deletedIds).toEqual([cardId]);
    expect(changes.items).toEqual([]);
    expect(changes.pageInfo).toEqual({ hasMore: false, nextCursor: null });
    const stranger = await t.query(internal.publicApi.listCardChangesForUser, {
      userId: "stranger",
      since: 0,
    });
    expect(stranger.deletedIds).toEqual([]);
  });

  test("pages through cards and then permanent deletions without repeats", async () => {
    const { t, cardId } = await setup();
    const purged = await t.run(async (ctx) => {
      const ids: Id<"cards">[] = [];
      for (const content of ["first", "second"]) {
        ids.push(
          await ctx.db.insert("cards", {
            userId: "owner",
            type: "text",
            content,
            isDeleted: true,
            deletedAt: 1,
            createdAt: 1,
            updatedAt: 1,
          })
        );
      }
      return ids;
    });
    for (const id of purged) {
      await t.mutation(internal["card/deleteCard"].permanentDeleteCardForUser, {
        userId: "owner",
        cardId: id,
      });
    }
    const seenItems: string[] = [];
    const seenDeleted: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const changes = await t.query(internal.publicApi.listCardChangesForUser, {
        userId: "owner",
        since: 0,
        limit: 1,
        cursor,
      });
      seenItems.push(...changes.items.map((card: { _id: string }) => card._id));
      seenDeleted.push(...changes.deletedIds);
      if (!changes.pageInfo.hasMore) {
        break;
      }
      cursor = changes.pageInfo.nextCursor ?? undefined;
    }
    expect(seenItems).toEqual([cardId]);
    expect(seenDeleted).toEqual(purged);
  });

  test("rejects a garbage cursor", async () => {
    const { t } = await setup();
    await expect(
      t.query(internal.publicApi.listCardChangesForUser, {
        userId: "owner",
        since: 0,
        cursor: btoa(JSON.stringify({ v: 2, phase: "nope" })),
      })
    ).rejects.toThrow("Query parameter `cursor` is invalid");
  });

  test("rejects a bare card-page cursor from before tombstones", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: "second",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const first = await t.query(internal.publicApi.listCardChangesForUser, {
      userId: "owner",
      since: 0,
      limit: 1,
    });
    const { cursor } = JSON.parse(atob(first.pageInfo.nextCursor ?? ""));
    await expect(
      t.query(internal.publicApi.listCardChangesForUser, {
        userId: "owner",
        since: 0,
        cursor,
      })
    ).rejects.toThrow("Query parameter `cursor` is invalid");
  });
});

describe("Stable pagination", () => {
  const insertCards = (
    t: Awaited<ReturnType<typeof setup>>["t"],
    contents: string[],
    firstCreatedAt: number
  ) =>
    t.run(async (ctx) => {
      const ids: Id<"cards">[] = [];
      for (const [index, content] of contents.entries()) {
        const id = await ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content,
          tags: ["paging"],
          createdAt: firstCreatedAt + index,
          updatedAt: firstCreatedAt + index,
        });
        await syncCardSearchDocumentHandler(ctx, id);
        await syncCardSearchTagsBatchHandler(ctx, id);
        ids.push(id);
      }
      return ids;
    });

  test.each([
    ["the plain list", {}],
    ["a date-filtered list", { createdAfter: 0 }],
  ])(
    "%s does not repeat a card when one is added between pages",
    async (_label, filter) => {
      const { t, cardId } = await setup();
      const [second, third] = await insertCards(t, ["two", "three"], 10);
      const first = await t.query(internal.publicApi.scanCardsPageForUser, {
        userId: "owner",
        scanLimit: 50,
        ...filter,
      });
      expect(first.items.map((card: { _id: string }) => card._id)).toEqual([
        third,
        second,
        cardId,
      ]);
      await insertCards(t, ["newest"], 100);
      const next = await t.query(internal.publicApi.scanCardsPageForUser, {
        userId: "owner",
        scanLimit: 50,
        cursor: first.itemCursors[1],
        ...filter,
      });
      expect(next.items.map((card: { _id: string }) => card._id)).toEqual([
        cardId,
      ]);
    }
  );

  test.each(["searchQuery", "tag"] as const)(
    "%s pages cover every match once, in date order, while cards are added",
    async (source) => {
      const { t } = await setup();
      const ids = await insertCards(
        t,
        ["paging a", "paging b", "paging c", "paging d", "paging e"],
        10
      );
      const query =
        source === "tag" ? { tag: "paging" } : { searchQuery: "paging" };
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const result = await t.query(
          internal.publicApi.searchCardsPageForUser,
          {
            userId: "owner",
            limit: 2,
            cursor,
            ...query,
          }
        );
        seen.push(...result.items.map((card: { _id: string }) => card._id));
        if (page === 0) {
          await insertCards(t, ["paging newest"], 100);
        }
        if (!result.pageInfo.hasMore) {
          break;
        }
        cursor = result.pageInfo.nextCursor ?? undefined;
      }
      expect(seen).toEqual([...ids].reverse());
    }
  );

  test("cards created in the same millisecond page by id across a tag page boundary", async () => {
    const { t } = await setup();
    const ids = await t.run(async (ctx) => {
      const created: Id<"cards">[] = [];
      for (let index = 0; index < 40; index += 1) {
        const id = await ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content: `tie ${index}`,
          tags: ["tie"],
          createdAt: index < 30 ? 50 : 40,
          updatedAt: 1,
        });
        await syncCardSearchTagsBatchHandler(ctx, id);
        created.push(id);
      }
      return created;
    });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await t.query(internal.publicApi.searchCardsPageForUser, {
        userId: "owner",
        tag: "tie",
        limit: 7,
        cursor,
      });
      seen.push(...result.items.map((card: { _id: string }) => card._id));
      if (!result.pageInfo.hasMore) {
        break;
      }
      cursor = result.pageInfo.nextCursor ?? undefined;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([...ids].map(String).sort());
  });

  test.each([
    ["scan", "not-base64!"],
    [
      "scan",
      btoa(
        JSON.stringify({ mode: "match", anchor: { createdAt: 1, id: "x" } })
      ),
    ],
    ["search", btoa(JSON.stringify({ mode: "list" }))],
    ["search", btoa("[1,2]")],
  ])("%s rejects the garbage cursor %s", async (kind, cursor) => {
    const { t } = await setup();
    const run =
      kind === "scan"
        ? t.query(internal.publicApi.scanCardsPageForUser, {
            userId: "owner",
            scanLimit: 10,
            cursor,
          })
        : t.query(internal.publicApi.searchCardsPageForUser, {
            userId: "owner",
            searchQuery: "Original",
            cursor,
          });
    await expect(run).rejects.toThrow("Query parameter `cursor` is invalid");
  });
});

describe("Web search pagination", () => {
  test("pages through search results once each, newest first", async () => {
    const { t } = await setup();
    const createdAts = [30, 10, 50, 20, 40];
    const ids = await t.run(async (ctx) => {
      const byCreatedAt: Record<number, string> = {};
      for (const createdAt of createdAts) {
        const id = await ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content: "webpaging note",
          createdAt,
          updatedAt: createdAt,
        });
        await syncCardSearchDocumentHandler(ctx, id);
        byCreatedAt[createdAt] = id;
      }
      return [50, 40, 30, 20, 10].map((createdAt) => byCreatedAt[createdAt]);
    });
    const owner = t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject: `user_${Buffer.from("owner").toString("hex")}`,
      sid: "session_web",
      email_verified: true,
      external_id: "owner",
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const result: {
        page: { _id: string }[];
        isDone: boolean;
        continueCursor: string | null;
      } = await owner.query(api.cards.searchCardsPaginated, {
        searchQuery: "webpaging",
        paginationOpts: { numItems: 2, cursor },
      });
      seen.push(...result.page.map((card: { _id: string }) => card._id));
      if (result.isDone) {
        break;
      }
      cursor = result.continueCursor;
    }
    expect(seen).toEqual(ids);
  });
});

describe("Tag listing", () => {
  test("counts active cards per tag from the tag index, including Teak's tags", async () => {
    const { t, cardId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch("cards", cardId, {
        tags: ["Design", "original"],
        aiTags: ["color"],
      });
      await syncCardSearchTagsBatchHandler(ctx, cardId);
      await syncCardSearchTagsBatchHandler(ctx, cardId);
      for (const [content, isDeleted] of [
        ["second", undefined],
        ["trashed", true],
      ] as const) {
        const id = await ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content,
          tags: ["design"],
          isDeleted,
          createdAt: 2,
          updatedAt: 2,
        });
        await syncCardSearchTagsBatchHandler(ctx, id);
      }
      const foreign = await ctx.db.insert("cards", {
        userId: "stranger",
        type: "text",
        content: "foreign",
        tags: ["design", "secret"],
        createdAt: 2,
        updatedAt: 2,
      });
      await syncCardSearchTagsBatchHandler(ctx, foreign);
    });
    const tags = await t.query(internal.publicApi.listTagsForUser, {
      userId: "owner",
    });
    expect(tags).toEqual({
      items: [
        { name: "design", count: 2 },
        { name: "color", count: 1 },
        { name: "original", count: 1 },
      ],
      isComplete: true,
    });
  });
});
