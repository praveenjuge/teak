import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createCardForUserHandler } from "../card/createCard";
import { createUploadedCardForUser } from "../card/uploadCard";
import { insertSeedCards, type SeedCardDef } from "../devSeed/helpers";
import { insertFolder } from "../folder/folders";
import schema from "../schema";
import type { TeakUserId } from "../securitySessions";
import { buildR2UserPrefix } from "../storage/r2";

const modules = import.meta.glob("../**/*.ts");

const NOW = Date.UTC(2026, 9, 20);
const OWNER = "owner" as TeakUserId;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  await seedWorkosOwner(t, OWNER);
  return t;
};

/**
 * The fields every card write derives from the rest of the card, as stored on
 * the card, its search document and its tag rows. Times are relative to the
 * card's `createdAt`; the random `shuffleKey` is reported by type only.
 */
const derivedFields = async (ctx: MutationCtx, cardId: Id<"cards">) => {
  const card = (await ctx.db.get("cards", cardId)) as Doc<"cards">;
  const searchDocument = await ctx.db
    .query("cardSearchDocuments")
    .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
    .unique();
  const tagRows = await ctx.db
    .query("cardSearchTags")
    .withIndex("by_cardId_and_tag", (q) => q.eq("cardId", cardId))
    .collect();
  const since = (value: number | undefined) =>
    value === undefined ? undefined : value - card.createdAt;
  return {
    type: card.type,
    content: card.content,
    url: card.url,
    sourceUrl: card.sourceUrl,
    urlHost: card.urlHost,
    urlKey: card.urlKey,
    isHidden: card.isHidden,
    aiPending: card.aiPending,
    createdAt: card.createdAt - NOW,
    savedAt: since(card.savedAt),
    updatedAt: since(card.updatedAt),
    shuffleKey: typeof card.shuffleKey,
    tags: card.tags,
    colorHexes: card.colorHexes,
    colorHues: card.colorHues,
    folderIds: card.folderIds?.length,
    isArchived: card.isArchived,
    isDeleted: card.isDeleted,
    isFavorited: card.isFavorited,
    completedAt: since(card.completedAt),
    metadataTitle: card.metadataTitle,
    metadataStatus: card.metadataStatus,
    aiTranscriptCharCount: card.aiTranscriptCharCount,
    search: searchDocument && {
      searchableText: searchDocument.searchableText,
      urlHost: searchDocument.urlHost,
      isHidden: searchDocument.isHidden,
      isArchived: searchDocument.isArchived,
      isDeleted: searchDocument.isDeleted,
      isFavorited: searchDocument.isFavorited,
      cardSavedAt: since(searchDocument.cardSavedAt),
    },
    tagRows: tagRows
      .map((row) => `${row.tag}${row.isCounted ? " (counted)" : ""}`)
      .sort(),
  };
};

const createCards = async (t: Awaited<ReturnType<typeof setup>>) => {
  const created = new Map<string, Id<"cards">>();
  await t.run(async (ctx) => {
    const create = async (
      name: string,
      args: Parameters<typeof createCardForUserHandler>[2],
      options: Parameters<typeof createCardForUserHandler>[3] = {}
    ) => {
      created.set(
        name,
        (await createCardForUserHandler(ctx, OWNER, args, options)).cardId
      );
    };
    await create("text with a hidden tag", {
      content: "A private note",
      tags: ["Secret", "work"],
    });
    await create("bare link", {
      content: "https://www.Example.com/post/?utm_source=x#top",
    });
    await create("text naming a link", {
      content: "Read https://news.ycombinator.com/item?id=1 later",
    });
    await create("quote", { content: '"Stay hungry, stay foolish."' });
    await create("palette", {
      content: "Sunset #ff6b35 #f7c59f #004e89",
      type: "palette",
    });
    await create("text with a source", {
      content: "Highlighted passage",
      sourceTitle: "The blog",
      sourceUrl: "https://www.blog.example.org/a?ref=feed",
    });
    await create(
      "imported link",
      {
        content: "https://imported.example.net/story",
        url: "https://imported.example.net/story",
        tags: ["reading"],
      },
      {
        importedVisibleFields: {
          completedAt: NOW - 1000,
          createdAt: NOW - 90_000,
          isArchived: true,
          isFavorited: true,
          metadataTitle: "  An imported story  ",
          savedAt: NOW - 50_000,
        },
        skipResave: true,
        source: "import",
      }
    );
    const folderId = await insertFolder(ctx, OWNER, "Reading", "blue");
    await create(
      "link filed in a folder",
      { content: "https://folder.example.com/item" },
      { resolveFolderIds: async () => [folderId] }
    );
    created.set(
      "uploaded image",
      await createUploadedCardForUser(ctx, {
        userId: OWNER,
        fileKey: `${buildR2UserPrefix(OWNER)}/uploads/photo.png`,
        fileName: "photo.png",
        fileSize: 2048,
        fileType: "image/png",
        storedFileSize: 2048,
        storedFileType: "image/png",
        tags: ["hidden"],
      })
    );
  });
  vi.advanceTimersByTime(60_000);
  await t.run(async (ctx) => {
    await createCardForUserHandler(ctx, OWNER, {
      content: "http://example.com/post",
    });
  });

  const defs: [string, SeedCardDef][] = [
    [
      "completed link",
      {
        type: "link",
        content: "https://www.seeded.example.com/page/",
        url: "https://www.seeded.example.com/page/",
        aiSummary: "A seeded page",
        aiTags: ["seed"],
        tags: ["Design"],
        createdAt: NOW - 10_000,
        savedAt: NOW - 5000,
      },
    ],
    [
      "completed text with a source",
      {
        type: "text",
        content: "Quoted from a site",
        sourceUrl: "https://www.source.example.com/x",
        sourceTitle: "Source",
        tags: ["hidden"],
        createdAt: NOW - 9000,
      },
    ],
    [
      "completed card in Trash",
      {
        type: "text",
        content: "Gone",
        isDeleted: true,
        createdAt: NOW - 8000,
      },
    ],
    [
      "completed audio with a transcript",
      {
        type: "audio",
        content: "",
        aiTranscript: "Hello from the recording",
        createdAt: NOW - 7000,
      },
    ],
    [
      "completed card without a shuffle key",
      {
        type: "text",
        content: "No shuffle",
        legacy: { noShuffleKey: true },
        createdAt: NOW - 6000,
      },
    ],
    [
      "completed link from before urlKey",
      {
        type: "link",
        content: "https://old.example.com/a",
        url: "https://old.example.com/a",
        legacy: { noUrlKey: true },
        createdAt: NOW - 5000,
      },
    ],
    [
      "unprocessed link",
      {
        type: "link",
        content: "https://pending.example.com/",
        url: "https://pending.example.com/",
        runProcessing: true,
        createdAt: NOW - 4000,
      },
    ],
    [
      "completed palette",
      {
        type: "palette",
        content: "Seeded palette",
        colors: [{ hex: "#112233" }, { hex: "#ffcc00", name: "Gold" }],
        isArchived: true,
        createdAt: NOW - 3000,
      },
    ],
  ];
  const ids = await t.run((ctx) =>
    insertSeedCards(
      ctx,
      OWNER,
      defs.map(([, def]) => def)
    )
  );
  for (const [index, [name]] of defs.entries()) {
    created.set(name, ids[index]);
  }
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return created;
};

describe("every way a card is written derives the same fields", () => {
  test("cards from each creation path and a re-save", async () => {
    const t = await setup();
    const created = await createCards(t);
    const derived = new Map<string, unknown>();
    await t.run(async (ctx) => {
      for (const [name, cardId] of created) {
        derived.set(name, await derivedFields(ctx, cardId));
      }
    });
    expect(Object.fromEntries(derived)).toMatchSnapshot();
  });
});
