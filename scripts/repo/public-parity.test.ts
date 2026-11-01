import { describe, expect, test } from "bun:test";
import type { Command } from "commander";
import { program } from "../../apps/cli/src/index";
import {
  callTeakV1Tool,
  type PublicApiToolOperation,
  TEAK_V1_TOOLS,
} from "../../packages/convex/mcp/tools";
import { PUBLIC_API_ERROR_CODES } from "../../packages/convex/publicApi/http/shared";
import { openApiSpec } from "../../packages/convex/publicApi/openApi/spec";
import { CARD_ERROR_CODES } from "../../packages/convex/shared/constants";
import {
  createTeakClient,
  disconnectConnectGrant,
  ERROR_CODES,
} from "../../packages/sdk/src/index";
import {
  APP_ONLY_CHANGES,
  CLI_LOCAL_COMMANDS,
  PUBLIC_PARITY,
  type PublicParityRow,
  SDK_LOCAL_MEMBERS,
  type Surface,
} from "./public-parity";

const names = (surface: Surface): readonly string[] =>
  Array.isArray(surface) ? surface : [];

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

const operations = Object.entries(
  openApiSpec.paths as Record<string, Record<string, { operationId?: string }>>
).flatMap(([path, methods]) =>
  HTTP_METHODS.flatMap((method) => {
    const operationId = methods[method]?.operationId;
    if (!operationId) {
      return [];
    }
    return [
      { method: method.toUpperCase(), operationId, segments: path.split("/") },
    ];
  })
);

const pathMatches = (segments: readonly string[], path: string) => {
  const parts = path.split("/");
  return (
    parts.length === segments.length &&
    segments.every(
      (segment, index) =>
        parts[index] === segment ||
        (segment.startsWith("{") && (parts[index] ?? "") !== "")
    )
  );
};

const operationFor = (method: string, path: string) =>
  operations.find(
    (operation) =>
      operation.method === method.toUpperCase() &&
      pathMatches(operation.segments, path)
  )?.operationId;

const rowFor = (operationId: string): PublicParityRow | undefined =>
  PUBLIC_PARITY.find((row) => row.operationId === operationId);

const MCP_SAMPLES: Record<string, unknown> = {
  // The search and fetch pair ChatGPT connectors expect.
  fetch: { id: "card_1" },
  search: { query: "x" },
  teak_v1_add_cards_to_folder: { folderId: "folder_1", cardIds: ["card_1"] },
  teak_v1_bulk_cards: { operation: "create", items: [{ content: "x" }] },
  teak_v1_check_duplicate_url: { url: "https://example.com" },
  teak_v1_create_card: { content: "x" },
  teak_v1_create_folder: { name: "Reading" },
  teak_v1_create_highlight: { cardId: "card_1", quote: "x" },
  teak_v1_create_thumbnail_upload: {
    cardId: "card_1",
    mimeType: "image/png",
    fileSize: 10,
  },
  teak_v1_create_upload: {
    fileName: "a.png",
    mimeType: "image/png",
    fileSize: 10,
  },
  teak_v1_delete_card: { cardId: "card_1", confirm: true },
  teak_v1_delete_folder: { folderId: "folder_1", confirm: true },
  teak_v1_delete_highlight: { highlightId: "highlight_1", confirm: true },
  teak_v1_delete_tag: { tag: "design", confirm: true },
  teak_v1_find_similar_cards: { cardId: "card_1" },
  teak_v1_get_card: { cardId: "card_1" },
  teak_v1_get_card_changes: { since: 1 },
  teak_v1_get_card_content: { cardId: "card_1" },
  teak_v1_get_card_links: { cardId: "card_1" },
  teak_v1_get_folder: { folderId: "folder_1" },
  teak_v1_get_me: {},
  teak_v1_get_tag_operation: { operationId: "op_1" },
  teak_v1_list_cards: {},
  teak_v1_list_favorite_cards: {},
  teak_v1_list_folders: {},
  teak_v1_list_highlights: { cardId: "card_1" },
  teak_v1_list_tags: {},
  teak_v1_merge_tags: { from: "a", into: "b" },
  teak_v1_refresh_card: { cardId: "card_1" },
  teak_v1_remove_cards_from_folder: {
    folderId: "folder_1",
    cardIds: ["card_1"],
  },
  teak_v1_rename_tag: { from: "a", to: "b" },
  teak_v1_reset_card_thumbnail: { cardId: "card_1" },
  teak_v1_restore_card: { cardId: "card_1" },
  teak_v1_search_cards: { q: "x" },
  teak_v1_set_card_archived: { cardId: "card_1", isArchived: true },
  teak_v1_save_card_pdf: { cardId: "card_1" },
  teak_v1_set_card_done: { cardId: "card_1", done: true },
  teak_v1_set_card_favorite: { cardId: "card_1", isFavorited: true },
  teak_v1_set_card_thumbnail: { cardId: "card_1", fileKey: "key_1" },
  teak_v1_update_card: { cardId: "card_1", notes: "n" },
  teak_v1_update_folder: { folderId: "folder_1", name: "Later" },
  teak_v1_update_highlight: { highlightId: "highlight_1", note: null },
};

const mcpOperations = async (tool: string) => {
  const reached: string[] = [];
  await callTeakV1Tool(
    tool,
    MCP_SAMPLES[tool],
    new Request("https://teak.test/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    }),
    (operation: PublicApiToolOperation) => {
      reached.push(operationFor(operation.method, operation.path) ?? "?");
      return Promise.resolve(Response.json({}));
    }
  ).catch(() => undefined);
  return reached;
};

type SdkCall = (client: ReturnType<typeof createTeakClient>) => unknown;

const SDK_SAMPLES = new Map<string, SdkCall>(
  Object.entries({
    "cards.bulk": (c) => c.cards.bulk("create", [{ content: "x" }]),
    "cards.changes": (c) => c.cards.changes({ since: 1 }),
    "cards.content": (c) => c.cards.content("card_1"),
    "pageSnapshots.createUpload": (c) =>
      c.pageSnapshots.createUpload({ bytes: 1024 }),
    "cards.createThumbnailUpload": (c) =>
      c.cards.createThumbnailUpload("card_1", {
        fileSize: 1,
        mimeType: "image/png",
      }),
    "cards.create": (c) => c.cards.create({ content: "x" }),
    "cards.delete": (c) => c.cards.delete("card_1"),
    "cards.duplicate": (c) => c.cards.duplicate("https://example.com"),
    "cards.favorites": (c) => c.cards.favorites(),
    "cards.get": (c) => c.cards.get("card_1"),
    "cards.similar": (c) => c.cards.similar("card_1"),
    "cards.links": (c) => c.cards.links("card_1"),
    "cards.list": (c) => c.cards.list(),
    "cards.refresh": (c) => c.cards.refresh("card_1"),
    "cards.resetThumbnail": (c) => c.cards.resetThumbnail("card_1"),
    "cards.restore": (c) => c.cards.restore("card_1"),
    "cards.search": (c) => c.cards.search({ q: "x" }),
    "cards.setArchived": (c) => c.cards.setArchived("card_1", true),
    "cards.savePdf": (c) => c.cards.savePdf("card_1"),
    "cards.setDone": (c) => c.cards.setDone("card_1", true),
    "cards.setFavorite": (c) => c.cards.setFavorite("card_1", true),
    "cards.setThumbnail": (c) =>
      c.cards.setThumbnail("card_1", { fileKey: "key_1" }),
    "cards.update": (c) => c.cards.update("card_1", { notes: "n" }),
    "exports.latest": (c) => c.exports.latest(),
    "exports.start": (c) => c.exports.start(),
    "folders.addCards": (c) => c.folders.addCards("folder_1", ["card_1"]),
    "folders.create": (c) => c.folders.create({ name: "Reading" }),
    "folders.delete": (c) => c.folders.delete("folder_1"),
    "folders.get": (c) => c.folders.get("folder_1"),
    "folders.list": (c) => c.folders.list(),
    "folders.removeCards": (c) => c.folders.removeCards("folder_1", ["card_1"]),
    "folders.update": (c) => c.folders.update("folder_1", { name: "Later" }),
    "highlights.create": (c) => c.highlights.create("card_1", { quote: "x" }),
    "highlights.delete": (c) => c.highlights.delete("highlight_1"),
    "highlights.list": (c) => c.highlights.list("card_1"),
    "highlights.update": (c) =>
      c.highlights.update("highlight_1", { note: null }),
    me: (c) => c.me(),
    "tags.delete": (c) => c.tags.delete("design"),
    "tags.list": (c) => c.tags.list(),
    "tags.merge": (c) => c.tags.merge("a", "b"),
    "tags.operation": (c) => c.tags.operation("op_1"),
    "tags.rename": (c) => c.tags.rename("a", "b"),
    "uploads.create": (c) =>
      c.uploads.create({
        fileName: "a.png",
        mimeType: "image/png",
        fileSize: 1,
      }),
  } satisfies Record<string, SdkCall>)
);

const recordingFetch = (reached: string[]) =>
  ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    reached.push(
      operationFor(init?.method ?? "GET", url.pathname.replace(/^\/api/, "")) ??
        "?"
    );
    return Promise.resolve(Response.json({}));
  }) as typeof fetch;

const sdkOperations = async (member: string) => {
  const reached: string[] = [];
  if (member === "disconnectConnectGrant") {
    const original = globalThis.fetch;
    globalThis.fetch = recordingFetch(reached);
    try {
      await disconnectConnectGrant("https://teak.test/api", "token").catch(
        () => undefined
      );
    } finally {
      globalThis.fetch = original;
    }
    return reached;
  }
  const client = createTeakClient({
    baseUrl: "https://teak.test/api",
    fetch: recordingFetch(reached),
    tokenProvider: { getAccessToken: () => "token" },
  });
  await Promise.resolve(SDK_SAMPLES.get(member)?.(client)).catch(
    () => undefined
  );
  return reached;
};

const sdkMembers = () => {
  const client = createTeakClient({
    tokenProvider: { getAccessToken: () => "token" },
  }) as unknown as Record<string, unknown>;
  return Object.entries(client).flatMap(([key, value]) =>
    typeof value === "function"
      ? [key]
      : Object.keys(value as object).map((method) => `${key}.${method}`)
  );
};

const cliCommands = (command: Command, prefix: string[] = []): string[] =>
  command.commands.flatMap((child) => {
    const path = [...prefix, child.name()];
    return [path.join(" "), ...cliCommands(child, path)];
  });

describe("public surface parity", () => {
  test("the table lists every OpenAPI operation exactly once", () => {
    const documented = operations.map((operation) => operation.operationId);
    const listed = PUBLIC_PARITY.map((row) => row.operationId);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...documented].sort());
  });

  test("every MCP tool is in the table, and reaches its operation", async () => {
    const tools = TEAK_V1_TOOLS.map((tool) => tool.name);
    const listed = PUBLIC_PARITY.flatMap((row) => names(row.mcp));
    expect([...listed].sort()).toEqual([...tools].sort());
    for (const tool of tools) {
      const row = PUBLIC_PARITY.find((entry) =>
        names(entry.mcp).includes(tool)
      );
      expect({ tool, reached: await mcpOperations(tool) }).toEqual({
        tool,
        reached: [row?.operationId],
      });
    }
  });

  test("every SDK member is in the table, and reaches its operation", async () => {
    const members = sdkMembers().filter(
      (member) => !(member in SDK_LOCAL_MEMBERS)
    );
    const listed = PUBLIC_PARITY.flatMap((row) => names(row.sdk));
    expect([...listed].sort()).toEqual(
      [...members, "disconnectConnectGrant"].sort()
    );
    for (const row of PUBLIC_PARITY) {
      for (const member of names(row.sdk)) {
        expect({ member, reached: await sdkOperations(member) }).toEqual({
          member,
          reached: [row.operationId],
        });
      }
    }
  });

  test("every CLI command is in the table or does local work", () => {
    const commands = cliCommands(program);
    const listed = new Set(PUBLIC_PARITY.flatMap((row) => names(row.cli)));
    for (const name of listed) {
      expect(commands).toContain(name);
    }
    const unlisted = commands.filter(
      (name) => !(listed.has(name) || name in CLI_LOCAL_COMMANDS)
    );
    expect(unlisted).toEqual([]);
  });

  test("an operation left off a surface says why", () => {
    for (const row of PUBLIC_PARITY) {
      for (const surface of [row.mcp, row.sdk, row.cli]) {
        if (Array.isArray(surface)) {
          expect(surface.length).toBeGreaterThan(0);
        } else {
          expect((surface as { none: string }).none.length).toBeGreaterThan(10);
        }
      }
    }
    expect(rowFor("listCards")).toBeDefined();
  });

  test("an app-only change names its session function, why, and what reads it", async () => {
    for (const change of APP_ONLY_CHANGES) {
      expect(change.reason.length).toBeGreaterThan(10);
      const [modulePath, exportName] = change.convex.split(":");
      const module = (await import(
        `../../packages/convex/${modulePath}.ts`
      )) as Record<string, unknown>;
      expect({ change: change.convex, exported: exportName in module }).toEqual(
        { change: change.convex, exported: true }
      );
      if (change.readBy) {
        expect(rowFor(change.readBy)).toBeDefined();
      }
    }
  });

  test("no public operation, tool, method or command sets the account language", () => {
    const setter = /locale|language|preference/i;
    expect(
      operations.map((op) => op.operationId).filter((id) => setter.test(id))
    ).toEqual([]);
    expect(
      TEAK_V1_TOOLS.map((tool) => tool.name).filter((name) => setter.test(name))
    ).toEqual([]);
    expect(sdkMembers().filter((member) => setter.test(member))).toEqual([]);
    expect(cliCommands(program).filter((name) => setter.test(name))).toEqual(
      []
    );
  });

  test("the SDK knows every error code the API returns", () => {
    const known = new Set<string>(ERROR_CODES);
    expect(PUBLIC_API_ERROR_CODES.filter((code) => !known.has(code))).toEqual(
      []
    );
    const api = new Set<string>(PUBLIC_API_ERROR_CODES);
    expect(
      Object.values(CARD_ERROR_CODES).filter(
        (code) => !api.has(code) && code !== "TOO_MANY_FILES"
      )
    ).toEqual([]);
  });

  test("the card list filters match on the API, MCP and CLI", () => {
    const listCards = (
      openApiSpec.paths["/v1/cards"] as {
        get: { parameters: { name: string }[] };
      }
    ).get.parameters.map((parameter) => parameter.name);
    const mcpList = TEAK_V1_TOOLS.find(
      (tool) => tool.name === "teak_v1_list_cards"
    );
    if (!mcpList) {
      throw new Error("teak_v1_list_cards is missing");
    }
    const mcpFields = Object.keys(
      (mcpList.inputSchema as { properties: Record<string, unknown> })
        .properties
    );
    expect([...mcpFields].sort()).toEqual([...listCards].sort());

    const ls = program.commands.find((command) => command.name() === "ls");
    const flags = new Set(ls?.options.map((option) => option.long));
    const cliFlag = (parameter: string) =>
      parameter === "shuffleSeed"
        ? "--seed"
        : `--${parameter.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    const missing = listCards
      .filter((parameter) => parameter !== "q")
      .filter((parameter) => !flags.has(cliFlag(parameter)));
    expect(missing).toEqual([]);
  });
});
