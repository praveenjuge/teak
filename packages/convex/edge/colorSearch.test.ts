import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Pick<Doc<"cards">, "content" | "type"> &
  Partial<Omit<Doc<"cards">, "_id" | "_creationTime" | "userId">>;

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_colorsearch",
    email_verified: true,
    external_id: "owner",
  });
  const insert = (seed: CardSeed) =>
    t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        createdAt: 1000,
        updatedAt: 1000,
        ...seed,
        savedAt: seed.savedAt ?? seed.createdAt ?? 1000,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });

  interface Filters {
    hexFilters?: string[];
    hueFilters?: string[];
    showArchivedOnly?: boolean;
    showTrashOnly?: boolean;
    styleFilters?: string[];
    types?: Doc<"cards">["type"][];
  }
  const grid = async (filters: Filters, numItems = 2) => {
    const found: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 50; pages += 1) {
      const result: {
        continueCursor: string | null;
        isDone: boolean;
        page: { content: string }[];
      } = await owner.query(api.cards.searchCardsPaginated, {
        paginationOpts: { numItems, cursor },
        ...filters,
      });
      found.push(...result.page.map((card) => card.content));
      if (result.isDone) {
        return found;
      }
      cursor = result.continueCursor;
    }
    throw new Error("the grid never finished");
  };
  const list = async (filters: Filters) =>
    (await owner.query(api.cards.searchCards, filters)).map(
      (card: { content: string }) => card.content
    );
  return { insert, grid, list };
};

describe("color and style search", () => {
  const seed = async (insert: (seed: CardSeed) => Promise<unknown>) => {
    await insert({
      content: "Sunset palette",
      type: "palette",
      colorHues: ["orange", "yellow"],
      colorHexes: ["#FF6B35"],
      createdAt: 3000,
    });
    await insert({
      content: "Coral lily",
      type: "image",
      colorHues: ["orange"],
      colorHexes: ["#FFA050"],
      visualStyles: ["photographic"],
      createdAt: 2000,
    });
    await insert({
      content: "Ocean palette",
      type: "palette",
      colorHues: ["blue"],
      colorHexes: ["#1E90FF"],
      createdAt: 1000,
    });
    await insert({
      content: "Campfire clip",
      type: "video",
      colorHues: ["orange", "brown"],
      colorHexes: ["#E8792B"],
      createdAt: 750,
    });
    await insert({ content: "Orange notes", type: "text", createdAt: 500 });
  };

  test("a hue finds the images, palettes and videos that carry it", async () => {
    const { insert, grid, list } = await setup();
    await seed(insert);

    expect(await grid({ hueFilters: ["orange"] })).toEqual([
      "Sunset palette",
      "Coral lily",
      "Campfire clip",
    ]);
    expect(await list({ hueFilters: ["orange"] })).toEqual([
      "Sunset palette",
      "Coral lily",
      "Campfire clip",
    ]);
    await insert({
      content: "Lavender",
      type: "palette",
      colorHues: ["purple"],
    });
    expect(await grid({ hueFilters: ["violet"] })).toEqual(["Lavender"]);
  });

  test("a hex color finds its card", async () => {
    const { insert, grid, list } = await setup();
    await seed(insert);

    expect(await grid({ hexFilters: ["1e90ff"] })).toEqual(["Ocean palette"]);
    expect(await list({ hexFilters: ["#1E90FF"] })).toEqual(["Ocean palette"]);
    expect(await grid({ hexFilters: ["#E8792B"] })).toEqual(["Campfire clip"]);
  });

  test("a visual style finds its images", async () => {
    const { insert, grid, list } = await setup();
    await seed(insert);

    expect(await grid({ styleFilters: ["photographic"] })).toEqual([
      "Coral lily",
    ]);
    expect(await list({ styleFilters: ["photographic"] })).toEqual([
      "Coral lily",
    ]);
  });

  test("filters combine with types, and a type without colors finds none", async () => {
    const { insert, grid } = await setup();
    await seed(insert);

    expect(await grid({ hueFilters: ["orange"], types: ["palette"] })).toEqual([
      "Sunset palette",
    ]);
    expect(await grid({ hueFilters: ["orange"], types: ["text"] })).toEqual([]);
  });

  test("the library, Archive and Trash each keep their own cards", async () => {
    const { insert, grid, list } = await setup();
    await insert({ content: "Library", type: "image", colorHues: ["blue"] });
    await insert({
      content: "Archived",
      type: "image",
      colorHues: ["blue"],
      isArchived: true,
    });
    await insert({
      content: "Trashed",
      type: "image",
      colorHues: ["blue"],
      isArchived: true,
      isDeleted: true,
    });

    expect(await grid({ hueFilters: ["blue"] })).toEqual(["Library"]);
    expect(
      await grid({ hueFilters: ["blue"], showArchivedOnly: true })
    ).toEqual(["Archived"]);
    expect(await grid({ hueFilters: ["blue"], showTrashOnly: true })).toEqual([
      "Trashed",
    ]);
    expect(await list({ hueFilters: ["blue"] })).toEqual(["Library"]);
  });

  test("a match among many newer cards is still found", async () => {
    const { insert, grid } = await setup();
    await insert({
      content: "Old orange",
      type: "palette",
      colorHues: ["orange"],
      createdAt: 1,
    });
    for (let index = 0; index < 60; index += 1) {
      await insert({
        content: `Blue ${index}`,
        type: "image",
        colorHues: ["blue"],
        createdAt: 100 + index,
      });
    }

    expect(await grid({ hueFilters: ["orange"] }, 10)).toEqual(["Old orange"]);
  });
});
