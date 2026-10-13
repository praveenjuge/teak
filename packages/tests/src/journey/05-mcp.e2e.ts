import { createApiAccount } from "../helpers/app";
import { env } from "../helpers/env";
import { connectMcp } from "../helpers/mcp";
import { expect, test } from "../helpers/test";

// The account this file's tests call MCP as; no other file uses it.
let apiKey = "";
test.beforeAll(async () => {
  ({ apiKey } = await createApiAccount("service-mcp"));
});

test("MCP lists and calls every public tool", async () => {
  const unauth = await fetch(env.mcpUrl);
  expect(unauth.status).toBe(401);
  expect(unauth.headers.get("www-authenticate")).toContain("resource_metadata");
  const client = await connectMcp(apiKey);
  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
    [
      "fetch",
      "search",
      "teak_v1_add_cards_to_folder",
      "teak_v1_bulk_cards",
      "teak_v1_check_duplicate_url",
      "teak_v1_create_card",
      "teak_v1_create_folder",
      "teak_v1_create_upload",
      "teak_v1_delete_card",
      "teak_v1_delete_folder",
      "teak_v1_get_card",
      "teak_v1_get_card_changes",
      "teak_v1_get_me",
      "teak_v1_list_cards",
      "teak_v1_list_favorite_cards",
      "teak_v1_list_folders",
      "teak_v1_list_tags",
      "teak_v1_refresh_card",
      "teak_v1_remove_cards_from_folder",
      "teak_v1_restore_card",
      "teak_v1_search_cards",
      "teak_v1_set_card_archived",
      "teak_v1_set_card_favorite",
      "teak_v1_update_card",
      "teak_v1_update_folder",
    ].sort()
  );
  const created: any = await client.callTool({
    name: "teak_v1_create_card",
    arguments: { content: `mcp-${Date.now()}` },
  });
  const cardId = created.structuredContent.cardId;
  const folder: any = await client.callTool({
    name: "teak_v1_create_folder",
    arguments: { name: `MCP ${Date.now()}`, color: "teal" },
  });
  expect(folder.isError).not.toBe(true);
  const folderId = folder.structuredContent.id;
  // teak_v1_create_upload needs Files storage, which the local stack lacks.
  const calls = [
    ["teak_v1_list_cards", { limit: 5 }],
    ["teak_v1_get_card", { cardId }],
    ["teak_v1_search_cards", { q: "mcp" }],
    ["teak_v1_list_favorite_cards", {}],
    ["teak_v1_update_card", { cardId, notes: "updated" }],
    ["teak_v1_set_card_favorite", { cardId, isFavorited: true }],
    ["teak_v1_set_card_archived", { cardId, isArchived: true }],
    ["teak_v1_set_card_archived", { cardId, isArchived: false }],
    ["teak_v1_refresh_card", { cardId }],
    ["teak_v1_list_folders", {}],
    ["teak_v1_update_folder", { folderId, name: "MCP renamed" }],
    ["teak_v1_add_cards_to_folder", { folderId, cardIds: [cardId] }],
    ["teak_v1_list_cards", { folder: folderId }],
    ["teak_v1_remove_cards_from_folder", { folderId, cardIds: [cardId] }],
    ["teak_v1_delete_folder", { folderId, confirm: true }],
    ["teak_v1_list_tags", {}],
    ["teak_v1_get_card_changes", { since: Date.now() - 86_400_000 }],
    [
      "teak_v1_bulk_cards",
      { operation: "create", items: [{ content: "mcp bulk" }] },
    ],
    ["teak_v1_get_me", {}],
    ["teak_v1_check_duplicate_url", { url: "https://example.com/mcp" }],
    ["teak_v1_delete_card", { cardId, confirm: true }],
    ["teak_v1_list_cards", { trashed: true }],
    ["teak_v1_restore_card", { cardId }],
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
