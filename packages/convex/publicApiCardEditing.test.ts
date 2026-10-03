/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
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
      metadataTitle: "Original title",
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
      searchQuery: "title",
    });
    expect(oldTitle[0]?.metadataTitle).toBe("Edited title");
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
    expect(updated?.metadataTitle).toBe("Original title");
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
    expect(card?.metadataTitle).toBe("Original title");
  });
});
