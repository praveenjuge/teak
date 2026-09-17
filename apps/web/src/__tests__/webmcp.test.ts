import { describe, expect, test } from "bun:test";
import {
  getModelContext,
  normalizeGetToolInput,
  normalizeSearchToolInput,
  registerTeakWebMcpTools,
  toWebMcpCardDetail,
  toWebMcpCardSummary,
  WEBMCP_GET_INPUT_SCHEMA,
  WEBMCP_SEARCH_INPUT_SCHEMA,
  type WebMcpCardInput,
  type WebMcpModelContext,
  type WebMcpToolDefinition,
} from "../lib/webmcp";

const cardFixture = (
  overrides: Partial<WebMcpCardInput> = {}
): WebMcpCardInput => ({
  _id: "jd7abc123",
  content: "A note about mechanical keyboards.",
  type: "text",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  ...overrides,
});

describe("webmcp modelContext detection", () => {
  test("returns null when the browser exposes no modelContext", () => {
    expect(getModelContext()).toBeNull();
  });
});

describe("webmcp search input normalization", () => {
  test("defaults an omitted input to recent cards with the default limit", () => {
    expect(normalizeSearchToolInput(undefined)).toEqual({ limit: 20 });
  });

  test("trims the query and drops blank queries", () => {
    expect(normalizeSearchToolInput({ q: "  keyboards  " })).toEqual({
      q: "keyboards",
      limit: 20,
    });
    expect(normalizeSearchToolInput({ q: "   " })).toEqual({ limit: 20 });
  });

  test("clamps the limit into range", () => {
    expect(normalizeSearchToolInput({ limit: 0 }).limit).toBe(1);
    expect(normalizeSearchToolInput({ limit: 999 }).limit).toBe(50);
    expect(normalizeSearchToolInput({ limit: 5 }).limit).toBe(5);
  });

  test("rejects unknown card types and malformed fields", () => {
    expect(() => normalizeSearchToolInput("keyboards")).toThrow(/object/);
    expect(() => normalizeSearchToolInput({ q: 42 })).toThrow(/"q"/);
    expect(() => normalizeSearchToolInput({ type: "spreadsheet" })).toThrow(
      /"type"/
    );
    expect(() => normalizeSearchToolInput({ limit: 2.5 })).toThrow(/"limit"/);
    expect(() => normalizeSearchToolInput({ favorited: "yes" })).toThrow(
      /"favorited"/
    );
  });

  test("accepts filters", () => {
    expect(
      normalizeSearchToolInput({ type: "link", favorited: true, limit: 5 })
    ).toEqual({ limit: 5, type: "link", favorited: true });
  });
});

describe("webmcp get input normalization", () => {
  test("trims the card id", () => {
    expect(normalizeGetToolInput({ cardId: "  abc  " })).toEqual({
      cardId: "abc",
    });
  });

  test("rejects missing or blank card ids", () => {
    expect(() => normalizeGetToolInput({})).toThrow(/"cardId"/);
    expect(() => normalizeGetToolInput({ cardId: "  " })).toThrow(/"cardId"/);
    expect(() => normalizeGetToolInput(null)).toThrow(/object/);
  });
});

describe("webmcp card shaping", () => {
  test("summarizes the fields agents need", () => {
    expect(
      toWebMcpCardSummary(
        cardFixture({
          url: "https://example.com",
          tags: ["setup"],
          metadataTitle: "Desk setup",
          isFavorited: true,
        })
      )
    ).toEqual({
      id: "jd7abc123",
      type: "text",
      title: "Desk setup",
      url: "https://example.com",
      excerpt: "A note about mechanical keyboards.",
      tags: ["setup"],
      isFavorited: true,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
    });
  });

  test("truncates long excerpts and content", () => {
    const long = "x".repeat(9000);
    const summary = toWebMcpCardSummary(cardFixture({ content: long }));
    expect(summary.excerpt).toBe("x".repeat(280));

    const detail = toWebMcpCardDetail(cardFixture({ content: long }));
    expect(detail.content).toBe("x".repeat(8000));
    expect(detail.contentTruncated).toBe(true);
    expect(detail.notes).toBeNull();
  });

  test("keeps short content intact", () => {
    const detail = toWebMcpCardDetail(cardFixture({ notes: "buy switches" }));
    expect(detail.content).toBe("A note about mechanical keyboards.");
    expect(detail.contentTruncated).toBe(false);
    expect(detail.notes).toBe("buy switches");
  });
});

describe("webmcp tool registration", () => {
  const setup = () => {
    const registered: WebMcpToolDefinition[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const modelContext: WebMcpModelContext = {
      registerTool: (tool, options) => {
        registered.push(tool);
        signals.push(options?.signal);
        return Promise.resolve();
      },
    };
    return { modelContext, registered, signals };
  };

  test("registers the read-only tools with schemas and the abort signal", async () => {
    const { modelContext, registered, signals } = setup();
    const controller = new AbortController();
    const messages: string[] = [];

    const names = await registerTeakWebMcpTools(
      modelContext,
      {
        searchCards: () => Promise.resolve([]),
        getCard: () => Promise.resolve(null),
      },
      { signal: controller.signal, logger: (message) => messages.push(message) }
    );

    expect(names).toEqual(["teak_search_cards", "teak_get_card"]);
    expect(registered.map((tool) => tool.name)).toEqual([
      "teak_search_cards",
      "teak_get_card",
    ]);
    expect(registered[0].inputSchema).toBe(WEBMCP_SEARCH_INPUT_SCHEMA);
    expect(registered[1].inputSchema).toBe(WEBMCP_GET_INPUT_SCHEMA);
    expect(registered[0].description).not.toBe("");
    expect(signals).toEqual([controller.signal, controller.signal]);
    expect(messages.join("\n")).toContain("teak_search_cards");
  });

  test("search execute normalizes input and summarizes results", async () => {
    const { modelContext, registered } = setup();
    const seen: unknown[] = [];
    const fakeSignal = new AbortController().signal;

    await registerTeakWebMcpTools(
      modelContext,
      {
        searchCards: (args) => {
          seen.push(args);
          return Promise.resolve([cardFixture()]);
        },
        getCard: () => Promise.resolve(null),
      },
      { logger: () => {} }
    );

    const result = await registered[0].execute(
      { q: "keyboards", limit: 999, type: "text", favorited: true },
      { signal: fakeSignal }
    );
    expect(seen).toEqual([
      {
        searchQuery: "keyboards",
        types: ["text"],
        favoritesOnly: true,
        limit: 50,
      },
    ]);
    expect(result).toEqual({
      items: [toWebMcpCardSummary(cardFixture())],
      total: 1,
    });
  });

  test("get execute returns the detail or null", async () => {
    const { modelContext, registered } = setup();
    const fakeSignal = new AbortController().signal;
    let requestedId: string | null = null;

    await registerTeakWebMcpTools(
      modelContext,
      {
        searchCards: () => Promise.resolve([]),
        getCard: (cardId) => {
          requestedId = cardId;
          return Promise.resolve(
            cardId === "exists" ? cardFixture({ _id: "exists" }) : null
          );
        },
      },
      { logger: () => {} }
    );

    const found = await registered[1].execute(
      { cardId: "exists" },
      { signal: fakeSignal }
    );
    expect(requestedId).toBe("exists");
    expect(found).toEqual(toWebMcpCardDetail(cardFixture({ _id: "exists" })));

    const missing = await registered[1].execute(
      { cardId: "nope" },
      { signal: fakeSignal }
    );
    expect(missing).toBeNull();
  });
});
