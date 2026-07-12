import { expect, test } from "@playwright/test";
import { env } from "../helpers/env";
import { cliFileFixtures } from "../helpers/file-formats";
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
    [
      "teak_v1_create_upload",
      { fileName: "mcp.txt", mimeType: "text/plain", fileSize: 1 },
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
    if (name === "teak_v1_create_upload") {
      expect(result.structuredContent ?? result.content).toBeTruthy();
    }
  }
  await client.close();
});

test("MCP uploads, creates, fetches, and searches expanded file cards", async () => {
  const apiKey = requireServiceApiKey("mcp");
  const marker = `mcp-file-${Date.now()}`;
  const client = await connectMcp(apiKey);
  try {
    for (const fixture of cliFileFixtures(marker)) {
      const prepared: any = await client.callTool({
        name: "teak_v1_create_upload",
        arguments: {
          fileName: fixture.fileName,
          fileSize: fixture.bytes.byteLength,
          mimeType: fixture.mimeType,
        },
      });
      expect(prepared.isError, fixture.fileName).not.toBe(true);
      const upload = prepared.structuredContent;
      const put = await fetch(upload.uploadUrl, {
        body: Uint8Array.from(fixture.bytes).buffer,
        headers: { "Content-Type": fixture.mimeType },
        method: "PUT",
      });
      expect(put.ok).toBe(true);

      const created: any = await client.callTool({
        name: "teak_v1_create_card",
        arguments: {
          fileKey: upload.fileKey,
          fileName: fixture.fileName,
          fileSize: fixture.bytes.byteLength,
          mimeType: fixture.mimeType,
          tags: ["prod-e2e", "file-formats"],
        },
      });
      expect(created.isError, fixture.fileName).not.toBe(true);
      const cardId = created.structuredContent.cardId;
      updateState((state) => state.createdCardIds.push(cardId));

      const fetched: any = await client.callTool({
        name: "teak_v1_get_card",
        arguments: { cardId },
      });
      expect(fetched.isError).not.toBe(true);
    }

    const searched: any = await client.callTool({
      name: "teak_v1_search_cards",
      arguments: { q: marker },
    });
    expect(searched.isError).not.toBe(true);
  } finally {
    await client.close();
  }
});
