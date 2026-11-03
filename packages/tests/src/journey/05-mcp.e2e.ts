import { createApiAccount } from "../helpers/app";
import { env } from "../helpers/env";
import { connectMcp } from "../helpers/mcp";
import { expect, retry, test } from "../helpers/test";

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
      "teak_v1_create_highlight",
      "teak_v1_create_thumbnail_upload",
      "teak_v1_create_upload",
      "teak_v1_delete_card",
      "teak_v1_delete_folder",
      "teak_v1_delete_highlight",
      "teak_v1_delete_tag",
      "teak_v1_find_similar_cards",
      "teak_v1_get_card",
      "teak_v1_get_card_changes",
      "teak_v1_get_card_content",
      "teak_v1_get_card_links",
      "teak_v1_get_folder",
      "teak_v1_get_me",
      "teak_v1_get_tag_operation",
      "teak_v1_list_cards",
      "teak_v1_list_favorite_cards",
      "teak_v1_list_folders",
      "teak_v1_list_highlights",
      "teak_v1_list_pinned_cards",
      "teak_v1_list_tags",
      "teak_v1_merge_tags",
      "teak_v1_refresh_card",
      "teak_v1_remove_cards_from_folder",
      "teak_v1_rename_tag",
      "teak_v1_reorder_pinned_cards",
      "teak_v1_reset_card_thumbnail",
      "teak_v1_restore_card",
      "teak_v1_save_card_pdf",
      "teak_v1_search_cards",
      "teak_v1_set_card_archived",
      "teak_v1_set_card_done",
      "teak_v1_set_card_favorite",
      "teak_v1_set_card_pinned",
      "teak_v1_set_card_thumbnail",
      "teak_v1_update_card",
      "teak_v1_update_folder",
      "teak_v1_update_highlight",
    ].sort()
  );
  const tag = `mcp-tag-${Date.now()}`;
  const created: any = await client.callTool({
    name: "teak_v1_create_card",
    arguments: { content: `mcp-${Date.now()}`, tags: [tag, "mcp-other"] },
  });
  const cardId = created.structuredContent.cardId;
  const folder: any = await client.callTool({
    name: "teak_v1_create_folder",
    arguments: { name: `MCP ${Date.now()}`, color: "teal" },
  });
  expect(folder.isError).not.toBe(true);
  const folderId = folder.structuredContent.id;
  const link: any = await client.callTool({
    name: "teak_v1_create_card",
    arguments: { content: `https://example.com/mcp-done-${Date.now()}` },
  });
  const linkId = link.structuredContent.cardId;
  const setDone = (done: boolean): Promise<any> =>
    client.callTool({
      name: "teak_v1_set_card_done",
      arguments: { cardId: linkId, done },
    });
  const doneIds = async () => {
    const found: any = await client.callTool({
      name: "teak_v1_search_cards",
      arguments: { q: "is:done", mode: "keyword" },
    });
    return found.structuredContent.items.map((item: { id: string }) => item.id);
  };
  const marked = await setDone(true);
  expect(marked.isError).not.toBe(true);
  expect(marked.structuredContent.completedAt).toEqual(expect.any(Number));
  expect(await doneIds()).toContain(linkId);
  const unmarked = await setDone(false);
  expect(unmarked.isError).not.toBe(true);
  expect(unmarked.structuredContent.completedAt).toBeNull();
  expect(await doneIds()).not.toContain(linkId);
  const noPdf: any = await client.callTool({
    name: "teak_v1_save_card_pdf",
    arguments: { cardId },
  });
  expect(noPdf.isError).toBe(true);
  expect(JSON.stringify(noPdf.content)).toContain("INVALID_INPUT");
  const calls = [
    ["teak_v1_list_cards", { limit: 5 }],
    ["teak_v1_get_card", { cardId }],
    ["teak_v1_get_card_content", { cardId }],
    ["teak_v1_get_card_links", { cardId }],
    ["teak_v1_search_cards", { q: "mcp" }],
    ["teak_v1_list_favorite_cards", {}],
    ["teak_v1_update_card", { cardId, notes: "updated" }],
    ["teak_v1_set_card_favorite", { cardId, isFavorited: true }],
    ["teak_v1_set_card_pinned", { cardId, isPinned: true }],
    ["teak_v1_list_pinned_cards", {}],
    ["teak_v1_reorder_pinned_cards", { cardIds: [cardId] }],
    ["teak_v1_set_card_pinned", { cardId, isPinned: false }],
    ["teak_v1_set_card_archived", { cardId, isArchived: true }],
    ["teak_v1_set_card_archived", { cardId, isArchived: false }],
    ["teak_v1_refresh_card", { cardId }],
    ["teak_v1_list_folders", {}],
    ["teak_v1_get_folder", { folderId }],
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

  await retry(
    async () => {
      const listed: any = await client.callTool({
        name: "teak_v1_list_tags",
        arguments: {},
      });
      expect(
        listed.structuredContent.items.map(
          (item: { name: string }) => item.name
        )
      ).toContain(tag);
    },
    { timeout: 30_000 }
  );
  const finish = async (started: any) => {
    expect(
      started.isError,
      JSON.stringify(started.content ?? started.structuredContent)
    ).not.toBe(true);
    const operationId = started.structuredContent.operationId;
    await retry(
      async () => {
        const polled: any = await client.callTool({
          name: "teak_v1_get_tag_operation",
          arguments: { operationId },
        });
        expect(polled.structuredContent.status).toBe("completed");
      },
      { timeout: 30_000 }
    );
  };
  await finish(
    await client.callTool({
      name: "teak_v1_rename_tag",
      arguments: { from: tag, to: `${tag}-renamed` },
    })
  );
  await finish(
    await client.callTool({
      name: "teak_v1_merge_tags",
      arguments: { from: "mcp-other", into: `${tag}-renamed` },
    })
  );
  await finish(
    await client.callTool({
      name: "teak_v1_delete_tag",
      arguments: { tag: `${tag}-renamed`, confirm: true },
    })
  );
  await client.close();
});

test("MCP offers the card view that MCP Apps clients render", async () => {
  const client = await connectMcp(apiKey);
  try {
    expect(client.getServerCapabilities()?.resources).toBeDefined();
    expect(client.getServerVersion()).toMatchObject({
      name: "teak",
      title: "Teak",
    });
    const { resources } = await client.listResources();
    expect(resources).toEqual([
      expect.objectContaining({
        mimeType: "text/html;profile=mcp-app",
        uri: "ui://teak/cards.html",
      }),
    ]);
    const read = await client.readResource({ uri: "ui://teak/cards.html" });
    const [content] = read.contents as unknown as Array<{
      _meta: { ui: { csp: { resourceDomains: string[] }; domain: string } };
      text: string;
    }>;
    expect(content?.text).toContain("<!doctype html>");
    expect(content?._meta.ui.domain).toMatch(
      /^[0-9a-f]{32}\.claudemcpcontent\.com$/u
    );
    expect(content?._meta.ui.csp.resourceDomains).toHaveLength(1);

    const { tools } = await client.listTools();
    expect(
      tools
        .filter((tool) => tool._meta?.ui)
        .map((tool) => tool.name)
        .sort()
    ).toEqual([
      "teak_v1_create_card",
      "teak_v1_get_card",
      "teak_v1_list_cards",
      "teak_v1_list_favorite_cards",
      "teak_v1_list_pinned_cards",
      "teak_v1_search_cards",
    ]);
  } finally {
    await client.close();
  }
});

test("MCP returns a card's links and the cards that link to it", async () => {
  const client = await connectMcp(apiKey);
  const stamp = Date.now();
  const create = async (content: string) =>
    (
      (await client.callTool({
        name: "teak_v1_create_card",
        arguments: { content },
      })) as any
    ).structuredContent.cardId as string;
  const targetId = await create(`mcp-link-target-${stamp}`);
  const noteId = await create(`See [[Target|teak:${targetId}]] ${stamp}`);
  await retry(
    async () => {
      const result: any = await client.callTool({
        name: "teak_v1_get_card_links",
        arguments: { cardId: targetId },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        backlinks: [{ id: noteId, missing: false }],
        links: [],
      });
    },
    { timeout: 30_000 }
  );
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
