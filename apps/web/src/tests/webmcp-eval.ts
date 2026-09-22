#!/usr/bin/env bun
/**
 * WebMCP gold-scenario eval. Deterministic multi-tool flows against an
 * in-memory card store (no backend, no browser): registration shape,
 * search/get round-trips, the create -> tag -> favorite lifecycle,
 * invalid-input rejections, event wiring, and description/data isolation.
 *
 * Run: bun run test:webmcp-eval (from apps/web)
 */

import {
  registerTeakWebMcpTools,
  subscribeWebMcpToolEvents,
  WEBMCP_TOOL_EVENT_TYPES,
  WEBMCP_TOOL_NAMES,
  type WebMcpCardInput,
  type WebMcpModelContext,
  type WebMcpQueryDeps,
  type WebMcpToolDefinition,
} from "../lib/webmcp";

interface ScenarioResult {
  detail?: string;
  name: string;
  ok: boolean;
}

const results: ScenarioResult[] = [];

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const scenario = async (
  name: string,
  run: () => Promise<void> | void
): Promise<void> => {
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ detail, name, ok: false });
    console.error(`FAIL ${name}: ${detail}`);
  }
};

const cardFixture = (
  overrides: Partial<WebMcpCardInput> & { _id: string }
): WebMcpCardInput => ({
  content: "eval fixture",
  createdAt: 1_700_000_000_000,
  type: "text",
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

/** In-memory store mirroring the Convex query/mutation semantics. */
const createStore = () => {
  const cards = new Map<string, WebMcpCardInput>([
    [
      "seed-keyboards",
      cardFixture({
        _id: "seed-keyboards",
        content: "A note about mechanical keyboards.",
        createdAt: 1_700_000_000_000,
        tags: ["setup"],
        updatedAt: 1_700_000_100_000,
      }),
    ],
    [
      "seed-tea",
      cardFixture({
        _id: "seed-tea",
        content: "Oolong brewing ratios.",
        createdAt: 1_700_000_200_000,
        isFavorited: true,
        tags: [],
        updatedAt: 1_700_000_200_000,
      }),
    ],
  ]);
  let sequence = 0;
  const deps: WebMcpQueryDeps = {
    createCard: (args) => {
      sequence += 1;
      const id = `created-${sequence}`;
      const now = 1_700_001_000_000 + sequence;
      cards.set(
        id,
        cardFixture({
          _id: id,
          content: args.content,
          createdAt: now,
          notes: args.notes,
          tags: args.tags,
          type: args.type,
          updatedAt: now,
          url: args.url,
        })
      );
      return Promise.resolve(id);
    },
    getCard: (cardId) => Promise.resolve(cards.get(cardId) ?? null),
    searchCards: (args) =>
      Promise.resolve(
        [...cards.values()]
          .filter((card) =>
            args.searchQuery
              ? card.content
                  .toLowerCase()
                  .includes(args.searchQuery.toLowerCase())
              : true
          )
          .filter((card) =>
            args.types ? args.types.includes(card.type as "text") : true
          )
          .filter((card) => (args.favoritesOnly ? card.isFavorited : true))
          .slice(0, args.limit ?? 20)
      ),
    updateCardField: ({ cardId, field, value }) => {
      const card = cards.get(cardId);
      if (!card) {
        return Promise.reject(new Error("card not found"));
      }
      if (field === "tags") {
        card.tags =
          Array.isArray(value) && value.length > 0 ? value : undefined;
      } else {
        card.isFavorited =
          typeof value === "boolean" ? value : !card.isFavorited;
      }
      return Promise.resolve(null);
    },
  };
  return { cards, deps };
};

const registerAll = async (deps: WebMcpQueryDeps) => {
  const registered: WebMcpToolDefinition[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const modelContext: WebMcpModelContext = {
    registerTool: (tool, options) => {
      registered.push(tool);
      signals.push(options?.signal);
      return Promise.resolve();
    },
  };
  const controller = new AbortController();
  const names = await registerTeakWebMcpTools(modelContext, deps, {
    logger: () => {},
    signal: controller.signal,
  });
  const byName = new Map(registered.map((tool) => [tool.name, tool]));
  const execute = (name: string, input: unknown): Promise<unknown> => {
    const tool = byName.get(name);
    if (!tool) {
      throw new Error(`tool ${name} is not registered`);
    }
    return tool.execute(input, { signal: controller.signal });
  };
  return { byName, controller, execute, names, registered, signals };
};

await scenario("registration exposes six annotated tools", async () => {
  const { deps } = createStore();
  const { names, registered, signals } = await registerAll(deps);
  assert(
    JSON.stringify(names) === JSON.stringify([...WEBMCP_TOOL_NAMES]),
    `tool order matches: ${names.join(",")}`
  );
  assert(registered.length === 6, "six tools registered");
  for (const tool of registered) {
    assert(tool.description.length > 0, `${tool.name} has a description`);
    assert(tool.inputSchema.type === "object", `${tool.name} has a schema`);
    assert(
      tool.inputSchema.additionalProperties === false,
      `${tool.name} forbids extra properties`
    );
  }
  const annotations = new Map(
    registered.map((tool) => [tool.name, tool.annotations])
  );
  for (const name of [
    "teak_search_cards",
    "teak_get_card",
    "teak_recent_cards",
  ]) {
    assert(
      annotations.get(name)?.readOnlyHint === true,
      `${name} is read-only`
    );
    assert(
      annotations.get(name)?.untrustedContentHint === true,
      `${name} marks output untrusted`
    );
  }
  for (const name of [
    "teak_create_card",
    "teak_update_tags",
    "teak_set_favorite",
  ]) {
    assert(
      annotations.get(name)?.consequentialHint === true,
      `${name} is consequential`
    );
  }
  assert(
    signals.every((signal) => signal instanceof AbortSignal),
    "every registration carries the abort signal"
  );
});

await scenario("search and get round-trip", async () => {
  const { deps } = createStore();
  const { execute } = await registerAll(deps);
  const found = (await execute("teak_search_cards", {
    q: "keyboards",
  })) as { items: { id: string }[]; total: number };
  assert(found.total === 1, "keyword search finds one card");
  assert(found.items[0].id === "seed-keyboards", "search returns the match");
  const detail = (await execute("teak_get_card", {
    cardId: "seed-keyboards",
  })) as { content: string; tags: string[] };
  assert(detail.content.includes("keyboards"), "detail carries content");
  assert(detail.tags.includes("setup"), "detail carries tags");
  const missing = await execute("teak_get_card", { cardId: "nope" });
  assert(missing === null, "unknown card returns null");
});

await scenario("create, tag, and favorite lifecycle", async () => {
  const { deps } = createStore();
  const { execute } = await registerAll(deps);
  const created = (await execute("teak_create_card", {
    content: "Lifecycle card",
    tags: ["inbox"],
  })) as { id: string; tags: string[] };
  assert(created.id === "created-1", "create returns the new id");
  const recent = (await execute("teak_recent_cards", { limit: 5 })) as {
    items: { id: string }[];
  };
  assert(recent.items[0].id === "created-1", "new card is the most recent");
  const tagged = (await execute("teak_update_tags", {
    add: ["project"],
    cardId: created.id,
    remove: ["inbox"],
  })) as { tags: string[] };
  assert(
    JSON.stringify(tagged.tags) === JSON.stringify(["project"]),
    "tags merge to the replacement list"
  );
  const favorited = (await execute("teak_set_favorite", {
    cardId: created.id,
    favorited: true,
  })) as { isFavorited: boolean };
  assert(favorited.isFavorited === true, "favorite flag is set");
  const favorites = (await execute("teak_search_cards", {
    favorited: true,
  })) as { items: { id: string }[] };
  assert(
    favorites.items.some((item) => item.id === "created-1"),
    "favorited card appears in favorites search"
  );
});

await scenario("invalid input is rejected per tool", async () => {
  const { deps } = createStore();
  const { execute } = await registerAll(deps);
  const cases: [string, unknown, RegExp][] = [
    ["teak_search_cards", { type: "spreadsheet" }, /"type"/],
    ["teak_get_card", { cardId: "  " }, /"cardId"/],
    ["teak_create_card", { content: "  " }, /"content"/],
    ["teak_create_card", { content: "x", type: "video" }, /"type"/],
    ["teak_update_tags", { cardId: "seed-tea" }, /add.*remove|empty/i],
    ["teak_update_tags", { add: ["x"], cardId: "nope" }, /not found/],
    ["teak_set_favorite", { cardId: "seed-tea" }, /"favorited"/],
    ["teak_set_favorite", { cardId: "nope", favorited: true }, /not found/],
    ["teak_recent_cards", { limit: 2.5 }, /"limit"/],
  ];
  for (const [name, input, pattern] of cases) {
    let message = "";
    try {
      await execute(name, input);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert(pattern.test(message), `${name} rejects (${message || "no error"})`);
  }
});

await scenario("tool events subscribe and clean up", () => {
  const listeners = new Map<string, Set<() => void>>();
  const modelContext: WebMcpModelContext = {
    addEventListener: (type, listener) => {
      const group = listeners.get(type) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(type, group);
    },
    registerTool: () => Promise.resolve(),
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
  };
  const seen: string[] = [];
  const unsubscribe = subscribeWebMcpToolEvents(modelContext, (type) => {
    seen.push(type);
  });
  for (const type of WEBMCP_TOOL_EVENT_TYPES) {
    for (const listener of listeners.get(type) ?? []) {
      listener();
    }
  }
  assert(seen.length === 3, "all three events fire");
  unsubscribe();
  assert(
    [...listeners.values()].every((group) => group.size === 0),
    "unsubscribe removes every listener"
  );
});

await scenario("descriptions never carry card data", async () => {
  const { deps } = createStore();
  const { registered } = await registerAll(deps);
  const blob = JSON.stringify(registered.map((tool) => tool.description));
  for (const secret of ["keyboards", "Oolong", "Lifecycle"]) {
    assert(!blob.includes(secret), `descriptions exclude "${secret}"`);
  }
});

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} scenarios passed`
);
if (failed.length > 0) {
  process.exitCode = 1;
}
