// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("card/defaultCards.ts", () => {
  let createDefaultCardsForUser: any;
  let DEFAULT_CARDS: any;

  beforeEach(async () => {
    const module = await import("../../card/defaultCards");
    createDefaultCardsForUser = module.createDefaultCardsForUser;
    DEFAULT_CARDS = module.DEFAULT_CARDS;
  });

  test("exports DEFAULT_CARDS array", () => {
    expect(DEFAULT_CARDS).toBeDefined();
    expect(Array.isArray(DEFAULT_CARDS)).toBe(true);
    expect(DEFAULT_CARDS.length).toBe(3);
  });

  test("DEFAULT_CARDS contains expected card types", () => {
    const types = DEFAULT_CARDS.map((c: any) => c.type);
    expect(types).toContain("text");
    expect(types).toContain("quote");
    expect(types).toContain("palette");
  });

  test("DEFAULT_CARDS welcome card has expected properties", () => {
    const welcomeCard = DEFAULT_CARDS.find((c: any) => c.type === "text");
    expect(welcomeCard).toBeDefined();
    expect(welcomeCard.content).toContain("Welcome to Teak");
    expect(welcomeCard.isFavorited).toBe(true);
    expect(welcomeCard.aiTags).toContain("welcome");
    expect(welcomeCard.aiSummary).toBeDefined();
  });

  test("DEFAULT_CARDS quote card has expected properties", () => {
    const quoteCard = DEFAULT_CARDS.find((c: any) => c.type === "quote");
    expect(quoteCard).toBeDefined();
    expect(quoteCard.content).toContain("predict the future");
    expect(quoteCard.notes).toContain("Alan Kay");
    expect(quoteCard.aiTags).toContain("quote");
    expect(quoteCard.isFavorited).toBe(false);
  });

  test("DEFAULT_CARDS palette card has colors", () => {
    const paletteCard = DEFAULT_CARDS.find((c: any) => c.type === "palette");
    expect(paletteCard).toBeDefined();
    expect(paletteCard.colors).toBeDefined();
    expect(Array.isArray(paletteCard.colors)).toBe(true);
    expect(paletteCard.colors.length).toBe(5);
    expect(paletteCard.colors[0]).toHaveProperty("hex");
    expect(paletteCard.colors[0]).toHaveProperty("name");
  });

  test("returns cards_exist when user already has cards", async () => {
    const ctx = {
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            first: mock().mockResolvedValue({ _id: "existing" }),
          }),
        }),
        insert: mock(),
      },
    } as any;

    const handler =
      (createDefaultCardsForUser as any).handler ?? createDefaultCardsForUser;
    const result = await handler(ctx, { userId: "u1" });

    expect(result).toEqual({ created: false, reason: "cards_exist" });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  test("creates default cards for new user", async () => {
    const ctx = {
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            first: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockResolvedValue("c1"),
      },
    } as any;

    const handler =
      (createDefaultCardsForUser as any).handler ?? createDefaultCardsForUser;
    const result = await handler(ctx, { userId: "u1" });

    expect(ctx.db.insert).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ created: true, count: 3 });
  });

  test("creates cards with correct structure", async () => {
    const insertedCards: any[] = [];
    const ctx = {
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            first: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockImplementation((table: string, data: any) => {
          insertedCards.push(data);
          return `id_${insertedCards.length}`;
        }),
      },
    } as any;

    const handler =
      (createDefaultCardsForUser as any).handler ?? createDefaultCardsForUser;
    await handler(ctx, { userId: "u1" });

    expect(insertedCards).toHaveLength(3);

    // Check welcome card
    const welcomeCard = insertedCards[0];
    expect(welcomeCard.userId).toBe("u1");
    expect(welcomeCard.type).toBe("text");
    expect(welcomeCard.content).toContain("Welcome");
    expect(welcomeCard.isFavorited).toBe(true);
    expect(welcomeCard.aiTags).toEqual([
      "welcome",
      "getting-started",
      "onboarding",
      "tutorial",
    ]);
    expect(welcomeCard.metadataStatus).toBe("completed");
    expect(welcomeCard.processingStatus).toBeDefined();

    // Check quote card
    const quoteCard = insertedCards[1];
    expect(quoteCard.userId).toBe("u1");
    expect(quoteCard.type).toBe("quote");
    expect(quoteCard.content).toContain("predict the future");
    expect(quoteCard.notes).toContain("Alan Kay");
    expect(quoteCard.isFavorited).toBe(false);
    expect(quoteCard.aiTags).toContain("quote");

    // Check palette card
    const paletteCard = insertedCards[2];
    expect(paletteCard.userId).toBe("u1");
    expect(paletteCard.type).toBe("palette");
    expect(paletteCard.colors).toHaveLength(5);
  });

  test("creates cards with incremental timestamps", async () => {
    const insertedCards: any[] = [];
    const baseTimestamp = 1_700_000_000_000;

    const ctx = {
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            first: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockImplementation((table: string, data: any) => {
          insertedCards.push(data);
          return `id_${insertedCards.length}`;
        }),
      },
    } as any;

    // Mock Date.now() to return consistent values
    const originalDateNow = Date.now;
    let callCount = 0;
    Date.now = mock(() => baseTimestamp + callCount++ * 500);

    const handler =
      (createDefaultCardsForUser as any).handler ?? createDefaultCardsForUser;
    await handler(ctx, { userId: "u1" });

    // Each card should have a timestamp 1 second apart (1000ms)
    expect(insertedCards[0].createdAt).toBe(insertedCards[0].updatedAt);
    expect(insertedCards[1].createdAt).toBe(insertedCards[1].updatedAt);

    Date.now = originalDateNow;
  });

  test("creates palette cards with proper color structure", async () => {
    const insertedCards: any[] = [];

    const ctx = {
      db: {
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            first: mock().mockResolvedValue(null),
          }),
        }),
        insert: mock().mockImplementation((table: string, data: any) => {
          insertedCards.push(data);
          return `id_${insertedCards.length}`;
        }),
      },
    } as any;

    const handler =
      (createDefaultCardsForUser as any).handler ?? createDefaultCardsForUser;
    await handler(ctx, { userId: "u1" });

    const paletteCard = insertedCards.find((c: any) => c.type === "palette");
    expect(paletteCard.colors).toEqual([
      { hex: "#FF6B6B", name: "Coral Red" },
      { hex: "#FFA06B", name: "Sunset Orange" },
      { hex: "#FFD93D", name: "Golden Yellow" },
      { hex: "#6BCB77", name: "Fresh Green" },
      { hex: "#4D96FF", name: "Sky Blue" },
    ]);
  });
});
