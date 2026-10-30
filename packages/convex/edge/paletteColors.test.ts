import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const hexes = (...values: string[]) => values.map((hex) => ({ hex }));
const lastColor = (card: Doc<"cards"> | null) =>
  card?.colors?.[card.colors.length - 1];

const setup = async (seed: Partial<Doc<"cards">> = {}) => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  await seedWorkosOwner(t, "stranger");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_palettecolors",
    email_verified: true,
    external_id: "owner",
  });
  const cardId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("cards", {
      userId: "owner",
      type: "palette",
      content: "Sunset palette",
      colors: hexes("#FF6B6B", "#FFA06B"),
      colorHexes: ["#FF6B6B", "#FFA06B"],
      colorHues: ["red", "orange"],
      createdAt: 1000,
      savedAt: 1000,
      updatedAt: 1000,
      ...seed,
    });
    await syncCardSearchDocumentHandler(ctx, id);
    return id;
  });
  const edit = (field: "addColor" | "removeColor", value: unknown) =>
    owner.mutation(api.cards.updateCardField, { cardId, field, value });
  const card = () => t.run((ctx) => ctx.db.get("cards", cardId));
  const colorHexes = async () =>
    ((await card())?.colors ?? []).map((color) => color.hex);
  const findByHex = async (hex: string) =>
    (await owner.query(api.cards.searchCards, { hexFilters: [hex] })).map(
      (found: { _id: string }) => found._id
    );
  const workflowStarts = () =>
    t.run(
      async (ctx) => (await ctx.db.query("workflowDispatches").collect()).length
    );
  return {
    t,
    owner,
    cardId,
    edit,
    card,
    colorHexes,
    findByHex,
    workflowStarts,
  };
};

describe("adding a palette color", () => {
  test("adds the full color, updates search, and runs no AI refresh", async () => {
    const { cardId, edit, card, findByHex, workflowStarts } = await setup();
    await edit("addColor", "  4ecdc4 ");
    const saved = await card();
    expect(lastColor(saved)).toMatchObject({
      hex: "#4ECDC4",
      rgb: { r: 78, g: 205, b: 196 },
    });
    expect(lastColor(saved)?.hsl).toBeDefined();
    expect(saved?.colorHexes).toEqual(["#FF6B6B", "#FFA06B", "#4ECDC4"]);
    expect(saved?.colorHues).toContain("teal");
    expect(saved?.content).toBe("Sunset palette");
    expect(await findByHex("#4ecdc4")).toEqual([cardId]);
    expect(await workflowStarts()).toBe(0);
  });

  test("names a color that has a name and expands a short hex", async () => {
    const { edit, card } = await setup();
    await edit("addColor", "#f00");
    expect(lastColor(await card())).toMatchObject({
      hex: "#FF0000",
      name: "red",
    });
  });

  test("skips a color the palette already has", async () => {
    const { edit, card } = await setup();
    await edit("addColor", "#ff6b6b");
    const saved = await card();
    expect(saved?.colors).toHaveLength(2);
    expect(saved?.updatedAt).toBe(1000);
  });

  test("refuses the thirteenth color", async () => {
    const twelve = Array.from(
      { length: 12 },
      (_, index) => `#0000${index.toString(16).padStart(2, "0")}`
    );
    const { edit, colorHexes } = await setup({ colors: hexes(...twelve) });
    await expect(edit("addColor", "#FFFFFF")).rejects.toThrow(
      "A palette holds up to 12 colors"
    );
    expect(await colorHexes()).toHaveLength(12);
  });

  test.each([
    ["not a hex code", "rgb(1, 2, 3)"],
    ["blank", "  "],
    ["not text", 42],
  ])("refuses a value that is %s", async (_, value) => {
    const { edit, colorHexes } = await setup();
    await expect(edit("addColor", value)).rejects.toThrow(
      "A color must be a hex code"
    );
    expect(await colorHexes()).toEqual(["#FF6B6B", "#FFA06B"]);
  });

  test("refuses a card that isn't a palette", async () => {
    const { edit } = await setup({ type: "image", content: "" });
    await expect(edit("addColor", "#FFFFFF")).rejects.toThrow(
      "Only palette cards have colors you can change"
    );
  });

  test("refuses a palette in Trash", async () => {
    const { edit, colorHexes } = await setup({
      isDeleted: true,
      deletedAt: 1000,
    });
    await expect(edit("addColor", "#FFFFFF")).rejects.toThrow(
      "Restore this card from Trash"
    );
    expect(await colorHexes()).toEqual(["#FF6B6B", "#FFA06B"]);
  });

  test("refuses another user's palette", async () => {
    const { t, cardId, colorHexes } = await setup();
    await expect(
      t.mutation(internal.publicApi.cardsForUser.patchCardForUser, {
        cardId,
        userId: "stranger",
        addColors: ["#FFFFFF"],
      })
    ).rejects.toThrow();
    expect(await colorHexes()).toEqual(["#FF6B6B", "#FFA06B"]);
  });
});

describe("removing a palette color", () => {
  test("removes it by any spelling and drops it from search", async () => {
    const { cardId, edit, card, findByHex } = await setup();
    expect(await findByHex("#FFA06B")).toEqual([cardId]);
    await edit("removeColor", "ffa06b");
    const saved = await card();
    expect(saved?.colors).toEqual(hexes("#FF6B6B"));
    expect(saved?.colorHexes).toEqual(["#FF6B6B"]);
    expect(saved?.colorHues).toEqual(["red"]);
    expect(await findByHex("#FFA06B")).toEqual([]);
  });

  test("removes every copy of a repeated color", async () => {
    const { edit, colorHexes } = await setup({
      colors: hexes("#FF6B6B", "#ffa06b", "#FFA06B", "#000000"),
    });
    await edit("removeColor", "#FFA06B");
    expect(await colorHexes()).toEqual(["#FF6B6B", "#000000"]);
  });

  test("a color the palette doesn't have changes nothing", async () => {
    const { edit, card } = await setup();
    await edit("removeColor", "#123456");
    expect((await card())?.updatedAt).toBe(1000);
  });

  test("keeps the last color", async () => {
    const { edit, colorHexes } = await setup({ colors: hexes("#FF6B6B") });
    await expect(edit("removeColor", "#FF6B6B")).rejects.toThrow(
      "A palette needs at least one color"
    );
    expect(await colorHexes()).toEqual(["#FF6B6B"]);
  });

  test("removes from a palette saved past today's cap", async () => {
    const fifteen = Array.from(
      { length: 15 },
      (_, index) => `#0000${index.toString(16).padStart(2, "0")}`
    );
    const { edit, colorHexes } = await setup({ colors: hexes(...fifteen) });
    await edit("removeColor", "#000000");
    expect(await colorHexes()).toHaveLength(14);
  });
});

describe("palette colors through the public API", () => {
  test("removes before adding, so one write swaps a one-color palette", async () => {
    const { t, cardId, colorHexes } = await setup({
      colors: hexes("#FF6B6B"),
    });
    const updated = await t.mutation(
      internal.publicApi.cardsForUser.patchCardForUser,
      {
        cardId,
        userId: "owner",
        removeColors: ["#FF6B6B"],
        addColors: ["#4ECDC4", "#4ecdc4", "#45B7D1"],
      }
    );
    expect(updated?.colors?.map((color: { hex: string }) => color.hex)).toEqual(
      ["#4ECDC4", "#45B7D1"]
    );
    expect(await colorHexes()).toEqual(["#4ECDC4", "#45B7D1"]);
  });

  test("an invalid color fails the whole write", async () => {
    const { t, cardId, colorHexes } = await setup();
    await expect(
      t.mutation(internal.publicApi.cardsForUser.patchCardForUser, {
        cardId,
        userId: "owner",
        addColors: ["#4ECDC4", "teal-ish"],
      })
    ).rejects.toThrow("A color must be a hex code");
    expect(await colorHexes()).toEqual(["#FF6B6B", "#FFA06B"]);
  });
});
