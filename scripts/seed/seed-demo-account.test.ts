import { describe, expect, test } from "bun:test";
import type { TeakClient } from "../../packages/sdk/src/index.ts";
import {
  DEMO_CARDS,
  DEMO_FOLDERS,
  DEMO_IMAGES,
  seedDemoAccount,
} from "./seed-demo-account.ts";

/** An in-memory library with just the calls the seed makes. */
const fakeTeak = () => {
  const cards: Array<{
    content?: string;
    fileName?: string;
    id: string;
    isFavorited?: boolean;
    url?: string;
  }> = [];
  const folders: Array<{ cardIds: string[]; id: string; name: string }> = [];
  const client = {
    cards: {
      create: (input: {
        content?: string;
        fileName?: string;
        url?: string;
      }) => {
        const id = `c${cards.length + 1}`;
        // Like Teak, keep a quote without its quotation marks.
        cards.push({
          ...input,
          content: input.content?.replace(/["“”]/gu, ""),
          id,
        });
        return Promise.resolve({ cardId: id, status: "created" });
      },
      duplicate: (url: string) =>
        Promise.resolve(cards.find((card) => card.url === url)?.id ?? null),
      // Like the API, leave out content and file names unless asked for.
      list: ({ include }: { include?: string } = {}) =>
        Promise.resolve({
          items: cards.map((card) => ({
            content: include?.includes("content") ? (card.content ?? "") : "",
            fileName: include?.includes("metadata")
              ? (card.fileName ?? null)
              : null,
            url: card.url ?? null,
          })),
          pageInfo: { hasMore: false, nextCursor: null },
        }),
      setFavorite: (id: string, isFavorited: boolean) => {
        const card = cards.find((item) => item.id === id);
        if (card) {
          card.isFavorited = isFavorited;
        }
        return Promise.resolve();
      },
    },
    folders: {
      addCards: (id: string, cardIds: string[]) => {
        folders.find((folder) => folder.id === id)?.cardIds.push(...cardIds);
        return Promise.resolve();
      },
      create: (input: { name: string }) => {
        const folder = { cardIds: [], id: `f${folders.length + 1}`, ...input };
        folders.push(folder);
        return Promise.resolve(folder);
      },
      list: () => Promise.resolve({ items: folders }),
    },
    uploads: {
      create: (input: { fileName: string }) =>
        Promise.resolve({ fileKey: `files/${input.fileName}`, uploadUrl: "u" }),
      putFile: () => Promise.resolve({ fileEtag: "etag" }),
    },
  };
  return { cards, client: client as unknown as TeakClient, folders };
};

describe("seedDemoAccount", () => {
  test("fills an empty library with cards, images, folders and favorites", async () => {
    const { cards, client, folders } = fakeTeak();
    const result = await seedDemoAccount(client, { log: () => undefined });
    expect(result).toEqual({
      created: DEMO_CARDS.length + DEMO_IMAGES.length,
      skipped: 0,
    });
    expect(cards.length).toBeGreaterThanOrEqual(45);
    expect(folders.map((folder) => folder.name).sort()).toEqual(
      [...DEMO_FOLDERS.map((folder) => folder.name), "Palettes"].sort()
    );
    expect(cards.filter((card) => card.isFavorited).length).toBeGreaterThan(5);
    expect(
      folders.find((folder) => folder.name === "Redesign")?.cardIds.length
    ).toBeGreaterThan(3);
  });

  test("saves nothing twice when run again", async () => {
    const { cards, client } = fakeTeak();
    await seedDemoAccount(client, { log: () => undefined });
    const before = cards.length;
    const again = await seedDemoAccount(client, { log: () => undefined });
    expect(again).toEqual({ created: 0, skipped: before });
    expect(cards).toHaveLength(before);
  });

  test("changes nothing on a dry run", async () => {
    const { cards, client, folders } = fakeTeak();
    const result = await seedDemoAccount(client, {
      dryRun: true,
      log: () => undefined,
    });
    expect(result.created).toBe(DEMO_CARDS.length + DEMO_IMAGES.length);
    expect(cards).toEqual([]);
    expect(folders).toEqual([]);
  });
});
