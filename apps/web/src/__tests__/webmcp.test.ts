import { describe, expect, test } from "bun:test";
import {
  getModelContext,
  mergeCardTags,
  normalizeCreateToolInput,
  normalizeFavoriteToolInput,
  normalizeGetToolInput,
  normalizeRecentToolInput,
  normalizeSearchToolInput,
  normalizeTagsToolInput,
  registerTeakWebMcpTools,
  subscribeWebMcpToolEvents,
  toWebMcpCardDetail,
  toWebMcpCardSummary,
  WEBMCP_CREATE_INPUT_SCHEMA,
  WEBMCP_FAVORITE_INPUT_SCHEMA,
  WEBMCP_GET_INPUT_SCHEMA,
  WEBMCP_RECENT_INPUT_SCHEMA,
  WEBMCP_SEARCH_INPUT_SCHEMA,
  WEBMCP_TAGS_INPUT_SCHEMA,
  WEBMCP_TOOL_EVENT_TYPES,
  type WebMcpCardInput,
  type WebMcpModelContext,
  type WebMcpQueryDeps,
  type WebMcpToolDefinition,
  type WebMcpToolEventType,
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

describe("webmcp create input normalization", () => {
  test("defaults the type to text and trims content", () => {
    expect(normalizeCreateToolInput({ content: "  hello  " })).toEqual({
      content: "hello",
      type: "text",
    });
  });

  test("accepts quote and link cards with optional fields", () => {
    expect(
      normalizeCreateToolInput({
        content: "wisdom",
        notes: " source ",
        tags: [" a ", "", "b"],
        type: "quote",
        url: " https://example.com ",
      })
    ).toEqual({
      content: "wisdom",
      notes: "source",
      tags: ["a", "b"],
      type: "quote",
      url: "https://example.com",
    });
  });

  test("rejects blank content and unsupported types", () => {
    expect(() => normalizeCreateToolInput({})).toThrow(/"content"/);
    expect(() => normalizeCreateToolInput({ content: "   " })).toThrow(
      /"content"/
    );
    expect(() =>
      normalizeCreateToolInput({ content: "x", type: "spreadsheet" })
    ).toThrow(/"type"/);
    expect(() =>
      normalizeCreateToolInput({ content: "x", type: "image" })
    ).toThrow(/"type"/);
    expect(() => normalizeCreateToolInput({ content: "x", tags: "a" })).toThrow(
      /"tags"/
    );
    expect(() => normalizeCreateToolInput(null)).toThrow(/object/);
  });
});

describe("webmcp tags input normalization", () => {
  test("trims the card id and cleans tag lists", () => {
    expect(
      normalizeTagsToolInput({ add: [" a ", ""], cardId: "  abc  " })
    ).toEqual({ add: ["a"], cardId: "abc", remove: [] });
  });

  test("rejects empty edits and overlapping lists", () => {
    expect(() => normalizeTagsToolInput({ cardId: "abc" })).toThrow(
      /add.*remove|empty/i
    );
    expect(() =>
      normalizeTagsToolInput({ add: [], cardId: "abc", remove: [] })
    ).toThrow(/add.*remove|empty/i);
    expect(() =>
      normalizeTagsToolInput({ add: ["a"], cardId: "abc", remove: ["a"] })
    ).toThrow(/both/i);
    expect(() => normalizeTagsToolInput({ add: ["a"] })).toThrow(/"cardId"/);
  });
});

describe("webmcp favorite input normalization", () => {
  test("requires a card id and an explicit boolean", () => {
    expect(
      normalizeFavoriteToolInput({ cardId: "abc", favorited: true })
    ).toEqual({ cardId: "abc", favorited: true });
    expect(() => normalizeFavoriteToolInput({ cardId: "abc" })).toThrow(
      /"favorited"/
    );
    expect(() =>
      normalizeFavoriteToolInput({ cardId: "abc", favorited: "yes" })
    ).toThrow(/"favorited"/);
    expect(() => normalizeFavoriteToolInput({ favorited: true })).toThrow(
      /"cardId"/
    );
  });
});

describe("webmcp recent input normalization", () => {
  test("defaults limit and accepts a type filter", () => {
    expect(normalizeRecentToolInput(undefined)).toEqual({ limit: 20 });
    expect(normalizeRecentToolInput({ limit: 5, type: "link" })).toEqual({
      limit: 5,
      type: "link",
    });
  });

  test("clamps the limit and rejects bad input", () => {
    expect(normalizeRecentToolInput({ limit: 0 }).limit).toBe(1);
    expect(normalizeRecentToolInput({ limit: 999 }).limit).toBe(50);
    expect(() => normalizeRecentToolInput({ type: "spreadsheet" })).toThrow(
      /"type"/
    );
    expect(() => normalizeRecentToolInput({ limit: 2.5 })).toThrow(/"limit"/);
    expect(() => normalizeRecentToolInput("recent")).toThrow(/object/);
  });
});

describe("webmcp tag merging", () => {
  test("adds, removes, and keeps tags with exact matching", () => {
    expect(mergeCardTags(["keep", "drop"], ["new"], ["drop"])).toEqual([
      "keep",
      "new",
    ]);
  });

  test("handles missing lists and dedupes additions", () => {
    expect(mergeCardTags(undefined, ["a"], [])).toEqual(["a"]);
    expect(mergeCardTags(["a"], ["a", "b"], [])).toEqual(["a", "b"]);
    expect(mergeCardTags(["a"], [], ["missing"])).toEqual(["a"]);
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
    const unusedDeps: WebMcpQueryDeps = {
      createCard: () => Promise.reject(new Error("unexpected createCard")),
      getCard: () => Promise.resolve(null),
      searchCards: () => Promise.resolve([]),
      updateCardField: () => Promise.reject(new Error("unexpected update")),
    };
    return { modelContext, registered, signals, unusedDeps };
  };

  test("registers the tools with schemas, annotations, and the abort signal", async () => {
    const { modelContext, registered, signals, unusedDeps } = setup();
    const controller = new AbortController();
    const messages: string[] = [];

    const names = await registerTeakWebMcpTools(modelContext, unusedDeps, {
      signal: controller.signal,
      logger: (message) => messages.push(message),
    });

    expect(names).toEqual([
      "teak_search_cards",
      "teak_get_card",
      "teak_create_card",
      "teak_update_tags",
      "teak_set_favorite",
      "teak_recent_cards",
    ]);
    expect(registered.map((tool) => tool.name)).toEqual(names);
    expect(registered[0].inputSchema).toBe(WEBMCP_SEARCH_INPUT_SCHEMA);
    expect(registered[1].inputSchema).toBe(WEBMCP_GET_INPUT_SCHEMA);
    expect(registered[2].inputSchema).toBe(WEBMCP_CREATE_INPUT_SCHEMA);
    expect(registered[3].inputSchema).toBe(WEBMCP_TAGS_INPUT_SCHEMA);
    expect(registered[4].inputSchema).toBe(WEBMCP_FAVORITE_INPUT_SCHEMA);
    expect(registered[5].inputSchema).toBe(WEBMCP_RECENT_INPUT_SCHEMA);
    expect(registered[0].description).not.toBe("");
    expect(registered[0].annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(registered[1].annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(registered[2].annotations).toEqual({ consequentialHint: true });
    expect(registered[3].annotations).toEqual({ consequentialHint: true });
    expect(registered[4].annotations).toEqual({ consequentialHint: true });
    expect(registered[5].annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(signals).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
    expect(messages.join("\n")).toContain("teak_search_cards");
  });

  test("search execute normalizes input and summarizes results", async () => {
    const { modelContext, registered, unusedDeps } = setup();
    const seen: unknown[] = [];
    const fakeSignal = new AbortController().signal;

    await registerTeakWebMcpTools(
      modelContext,
      {
        ...unusedDeps,
        searchCards: (args) => {
          seen.push(args);
          return Promise.resolve([cardFixture()]);
        },
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
    const { modelContext, registered, unusedDeps } = setup();
    const fakeSignal = new AbortController().signal;
    let requestedId: string | null = null;

    await registerTeakWebMcpTools(
      modelContext,
      {
        ...unusedDeps,
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

  test("create execute creates the card and reads it back", async () => {
    const { modelContext, registered, unusedDeps } = setup();
    const fakeSignal = new AbortController().signal;
    const seen: unknown[] = [];

    await registerTeakWebMcpTools(
      modelContext,
      {
        ...unusedDeps,
        createCard: (args) => {
          seen.push(args);
          return Promise.resolve("new-id");
        },
        getCard: (cardId) =>
          Promise.resolve(
            cardFixture({
              _id: cardId,
              tags: ["a"],
              url: "https://example.com",
            })
          ),
      },
      { logger: () => {} }
    );

    const result = await registered[2].execute(
      {
        content: "  fresh thought  ",
        tags: ["a"],
        type: "text",
        url: "https://example.com",
      },
      { signal: fakeSignal }
    );
    expect(seen).toEqual([
      {
        content: "fresh thought",
        tags: ["a"],
        type: "text",
        url: "https://example.com",
      },
    ]);
    expect(result).toEqual({
      id: "new-id",
      tags: ["a"],
      type: "text",
      url: "https://example.com",
    });
    await expect(
      registered[2].execute({ content: "  " }, { signal: fakeSignal })
    ).rejects.toThrow(/"content"/);
  });

  test("tags execute merges against the stored tags", async () => {
    const { modelContext, registered, unusedDeps } = setup();
    const fakeSignal = new AbortController().signal;
    const seen: unknown[] = [];

    await registerTeakWebMcpTools(
      modelContext,
      {
        ...unusedDeps,
        getCard: (cardId) =>
          Promise.resolve(
            cardId === "exists"
              ? cardFixture({ _id: "exists", tags: ["keep", "drop"] })
              : null
          ),
        updateCardField: (args) => {
          seen.push(args);
          return Promise.resolve(null);
        },
      },
      { logger: () => {} }
    );

    const result = await registered[3].execute(
      { add: ["new"], cardId: "exists", remove: ["drop"] },
      { signal: fakeSignal }
    );
    expect(seen).toEqual([
      { cardId: "exists", field: "tags", value: ["keep", "new"] },
    ]);
    expect(result).toEqual({ id: "exists", tags: ["keep", "new"] });
    await expect(
      registered[3].execute(
        { add: ["x"], cardId: "nope" },
        { signal: fakeSignal }
      )
    ).rejects.toThrow(/not found/);
  });

  test("favorite execute sets the flag explicitly", async () => {
    const { modelContext, registered, unusedDeps } = setup();
    const fakeSignal = new AbortController().signal;
    const seen: unknown[] = [];

    await registerTeakWebMcpTools(
      modelContext,
      {
        ...unusedDeps,
        getCard: (cardId) =>
          Promise.resolve(
            cardId === "exists" ? cardFixture({ _id: "exists" }) : null
          ),
        updateCardField: (args) => {
          seen.push(args);
          return Promise.resolve(null);
        },
      },
      { logger: () => {} }
    );

    const result = await registered[4].execute(
      { cardId: "exists", favorited: true },
      { signal: fakeSignal }
    );
    expect(seen).toEqual([
      { cardId: "exists", field: "isFavorited", value: true },
    ]);
    expect(result).toEqual({ id: "exists", isFavorited: true });
    await expect(
      registered[4].execute(
        { cardId: "nope", favorited: true },
        { signal: fakeSignal }
      )
    ).rejects.toThrow(/not found/);
  });

  test("recent execute sorts newest first and applies the limit", async () => {
    const { modelContext, registered, unusedDeps } = setup();
    const fakeSignal = new AbortController().signal;
    const seen: unknown[] = [];

    await registerTeakWebMcpTools(
      modelContext,
      {
        ...unusedDeps,
        searchCards: (args) => {
          seen.push(args);
          return Promise.resolve([
            cardFixture({ _id: "old", createdAt: 100 }),
            cardFixture({ _id: "new", createdAt: 300 }),
            cardFixture({ _id: "mid", createdAt: 200 }),
          ]);
        },
      },
      { logger: () => {} }
    );

    const result = (await registered[5].execute(
      { limit: 2 },
      { signal: fakeSignal }
    )) as { items: { id: string }[]; total: number };
    expect(seen).toEqual([{ limit: 2 }]);
    expect(result.items.map((item) => item.id)).toEqual(["new", "mid"]);
    expect(result.total).toBe(2);
  });
});

describe("webmcp tool event subscription", () => {
  const setup = () => {
    const listeners = new Map<string, Set<() => void>>();
    const modelContext: WebMcpModelContext = {
      addEventListener: (type, listener) => {
        const group = listeners.get(type) ?? new Set<() => void>();
        group.add(listener as () => void);
        listeners.set(type, group);
      },
      registerTool: () => Promise.resolve(),
      removeEventListener: (type, listener) => {
        listeners.get(type)?.delete(listener as () => void);
      },
    };
    const fire = (type: string): void => {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    };
    return { fire, listeners, modelContext };
  };

  test("subscribes to every tool event type and unsubscribes on cleanup", () => {
    const { fire, listeners, modelContext } = setup();
    const seen: WebMcpToolEventType[] = [];

    const unsubscribe = subscribeWebMcpToolEvents(modelContext, (type) => {
      seen.push(type);
    });

    expect([...listeners.keys()].sort()).toEqual(
      [...WEBMCP_TOOL_EVENT_TYPES].sort()
    );
    for (const type of WEBMCP_TOOL_EVENT_TYPES) {
      fire(type);
    }
    expect(seen).toEqual([...WEBMCP_TOOL_EVENT_TYPES]);

    unsubscribe();
    for (const group of listeners.values()) {
      expect(group.size).toBe(0);
    }
  });

  test("is a no-op when the context exposes no event listeners", () => {
    const seen: WebMcpToolEventType[] = [];
    const unsubscribe = subscribeWebMcpToolEvents(
      { registerTool: () => Promise.resolve() },
      (type) => {
        seen.push(type);
      }
    );
    expect(() => unsubscribe()).not.toThrow();
    expect(seen).toEqual([]);
  });
});
