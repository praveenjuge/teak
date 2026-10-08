import { expect, test } from "@playwright/test";
import { env } from "../helpers/env";
import { connectMcp } from "../helpers/mcp";
import { requireServiceApiKey, updateState } from "../helpers/run-state";

test("MCP lists and calls every public tool", async () => {
  const apiKey = requireServiceApiKey("mcp");
  const unauth = await fetch(env.mcpUrl);
  expect(unauth.status).toBe(401);
  expect(unauth.headers.get("www-authenticate")).toContain("resource_metadata");
  const client = await connectMcp(apiKey);
  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
    [
      "fetch",
      "search",
      "teak_v1_bulk_cards",
      "teak_v1_create_card",
      "teak_v1_create_upload",
      "teak_v1_delete_card",
      "teak_v1_get_card",
      "teak_v1_get_card_changes",
      "teak_v1_list_cards",
      "teak_v1_list_favorite_cards",
      "teak_v1_list_tags",
      "teak_v1_search_cards",
      "teak_v1_set_card_favorite",
      "teak_v1_update_card",
    ].sort()
  );
  const created: any = await client.callTool({
    name: "teak_v1_create_card",
    arguments: { content: `mcp-${Date.now()}` },
  });
  const cardId = created.structuredContent.cardId;
  // teak_v1_create_upload needs Files storage, which the local stack lacks.
  const calls = [
    ["teak_v1_list_cards", { limit: 5 }],
    ["teak_v1_get_card", { cardId }],
    ["teak_v1_search_cards", { q: "mcp" }],
    ["teak_v1_list_favorite_cards", {}],
    ["teak_v1_update_card", { cardId, notes: "updated" }],
    ["teak_v1_set_card_favorite", { cardId, isFavorited: true }],
    ["teak_v1_list_tags", {}],
    ["teak_v1_get_card_changes", { since: Date.now() - 86_400_000 }],
    [
      "teak_v1_bulk_cards",
      { operation: "create", items: [{ content: "mcp bulk" }] },
    ],
    ["search", { query: "mcp" }],
    ["fetch", { id: cardId }],
  ] as const;
  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    expect(
      result.isError,
      `${name} failed: ${JSON.stringify(result.content ?? result.structuredContent)}`
    ).not.toBe(true);
    if (name === "fetch") {
      expect(result.structuredContent ?? result.content).toBeTruthy();
    }
  }
  await client.close();
});

test("MCP bulk update and sync cursor return coherent changes", async () => {
  const apiKey = requireServiceApiKey("mcp");
  const marker = `mcp-bulk-sync-${Date.now()}`;
  const client = await connectMcp(apiKey);
  try {
    const created: any = await client.callTool({
      name: "teak_v1_create_card",
      arguments: {
        content: `${marker} original`,
        tags: ["e2e", "mcp-bulk"],
      },
    });
    expect(created.isError).not.toBe(true);
    const cardId = created.structuredContent.cardId;
    updateState((state) => state.createdCardIds.push(cardId));

    const since = Date.now() - 60_000;
    const bulk: any = await client.callTool({
      name: "teak_v1_bulk_cards",
      arguments: {
        operation: "update",
        items: [{ cardId, notes: `${marker} bulk-notes` }],
      },
    });
    expect(bulk.isError).not.toBe(true);
    expect(bulk.structuredContent?.summary?.succeeded ?? 1).toBeGreaterThan(0);

    const favorite: any = await client.callTool({
      name: "teak_v1_set_card_favorite",
      arguments: { cardId, isFavorited: true },
    });
    expect(favorite.isError).not.toBe(true);

    const changes: any = await client.callTool({
      name: "teak_v1_get_card_changes",
      arguments: { since },
    });
    expect(changes.isError).not.toBe(true);
    const payload = changes.structuredContent;
    expect(payload).toBeTruthy();
    expect(
      (payload.items ?? []).some(
        (card: { id?: string }) => card.id === cardId
      ) || Array.isArray(payload.deletedIds)
    ).toBe(true);

    const fetched: any = await client.callTool({
      name: "teak_v1_get_card",
      arguments: { cardId },
    });
    expect(fetched.isError).not.toBe(true);
    expect(String(fetched.structuredContent?.notes ?? "")).toContain(
      `${marker} bulk-notes`
    );
  } finally {
    await client.close();
  }
});
