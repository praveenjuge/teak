import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { Command } from "commander";
import { program } from "../../apps/cli/src/index";
import {
  TEAK_TOOLS,
  TEAK_V1_TOOLS,
  toolInputSchema,
} from "../../packages/convex/mcp/catalog";
import { callTeakV1Tool } from "../../packages/convex/mcp/tools";
import { CARD_ERROR_CODES } from "../../packages/convex/shared/constants";
import {
  APP_ONLY_CARD_ERROR_CODES,
  CARD_LIST_PARAMS,
  type CardListParam,
  cliFlagFor,
  matchPublicApiOperation,
  PUBLIC_API_ERROR_CODES,
  PUBLIC_API_OPERATION_IDS,
  type PublicApiOperationCall,
} from "../../packages/convex/shared/publicApiContract";
import {
  buildCardsSearchParams,
  createTeakClient,
  disconnectConnectGrant,
  ERROR_CODES,
} from "../../packages/sdk/src/index";
import {
  APP_ONLY_CHANGES,
  CLI_LOCAL_COMMANDS,
  mcpSurface,
  mcpToolsByOperation,
  PUBLIC_PARITY,
  type PublicParityRow,
  SDK_LOCAL_MEMBERS,
  type Surface,
  sampleFromSchema,
} from "./public-parity";

const names = (surface: Surface): readonly string[] =>
  Array.isArray(surface) ? surface : [];

const operationFor = (method: string, path: string) =>
  matchPublicApiOperation(method.toUpperCase(), path)?.operationId;

const rowFor = (operationId: string): PublicParityRow | undefined =>
  PUBLIC_PARITY.find((row) => row.operationId === operationId);

// The arguments generated from a tool's schema, except where the tool also
// checks fields together.
const REFINED_SAMPLES: Record<string, unknown> = {
  teak_v1_create_card: { content: "x" },
  teak_v1_update_card: { cardId: "card_1", notes: "n" },
  teak_v1_update_folder: { folderId: "folder_1", name: "Later" },
};

const mcpSample = (tool: (typeof TEAK_TOOLS)[number]) =>
  REFINED_SAMPLES[tool.name] ?? sampleFromSchema(toolInputSchema(tool.schema));

const mcpOperations = async (tool: (typeof TEAK_TOOLS)[number]) => {
  const reached: string[] = [];
  await callTeakV1Tool(
    tool.name,
    mcpSample(tool),
    new Request("https://teak.test/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    }),
    (call: PublicApiOperationCall) => {
      reached.push(call.operationId);
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
    "cards.pinned": (c) => c.cards.pinned(),
    "cards.reorderPinned": (c) => c.cards.reorderPinned(["card_1"]),
    "cards.list": (c) => c.cards.list(),
    "cards.refresh": (c) => c.cards.refresh("card_1"),
    "cards.resetThumbnail": (c) => c.cards.resetThumbnail("card_1"),
    "cards.restore": (c) => c.cards.restore("card_1"),
    "cards.search": (c) => c.cards.search({ query: "x" }),
    "cards.setArchived": (c) => c.cards.setArchived("card_1", true),
    "cards.savePdf": (c) => c.cards.savePdf("card_1"),
    "cards.setDone": (c) => c.cards.setDone("card_1", true),
    "cards.setFavorite": (c) => c.cards.setFavorite("card_1", true),
    "cards.setPinned": (c) => c.cards.setPinned("card_1", true),
    "cards.setThumbnail": (c) =>
      c.cards.setThumbnail("card_1", { fileKey: "key_1" }),
    "cards.update": (c) => c.cards.update("card_1", { notes: "n" }),
    "exports.latest": (c) => c.exports.latest(),
    "exports.start": (c) => c.exports.start(),
    "folders.addCards": (c) => c.folders.addCards("folder_1", ["card_1"]),
    "folders.create": (c) => c.folders.create({ name: "Reading" }),
    "folders.delete": (c) => c.folders.delete("folder_1"),
    "folders.get": (c) => c.folders.get("folder_1"),
    "folders.getRuleRun": (c) => c.folders.getRuleRun("folder_1", "run_1"),
    "folders.list": (c) => c.folders.list(),
    "folders.removeCards": (c) => c.folders.removeCards("folder_1", ["card_1"]),
    "folders.undoRuleRun": (c) => c.folders.undoRuleRun("folder_1", "run_1"),
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

// Listed commands only: a renamed command kept for old scripts is hidden.
const cliCommands = (command: Command, prefix: string[] = []): string[] =>
  command
    .createHelp()
    .visibleCommands(command)
    .filter((child) => child.name() !== "help")
    .flatMap((child) => {
      const path = [...prefix, child.name()];
      return [path.join(" "), ...cliCommands(child, path)];
    });

const raycastTools = () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../apps/raycast/package.json", import.meta.url),
      "utf8"
    )
  ) as { tools?: { name: string }[] };
  const files = readdirSync(
    new URL("../../apps/raycast/src/tools", import.meta.url)
  ).map((file) => file.replace(/\.ts$/, ""));
  return { files, manifest: (manifest.tools ?? []).map((tool) => tool.name) };
};

describe("public surface parity", () => {
  test("the table lists every operation exactly once", () => {
    const listed = PUBLIC_PARITY.map((row) => row.operationId);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...PUBLIC_API_OPERATION_IDS].sort());
  });

  test("every MCP tool reaches the operation its catalog entry names", async () => {
    const byOperation = mcpToolsByOperation();
    for (const tool of TEAK_TOOLS) {
      const operationId = [...byOperation].find(([, tools]) =>
        tools.includes(tool.name)
      )?.[0];
      expect({ tool: tool.name, reached: await mcpOperations(tool) }).toEqual({
        tool: tool.name,
        reached: [operationId ?? "(no catalog operation)"],
      });
    }
  });

  test("an operation no MCP tool calls says why, and one a tool calls doesn't", () => {
    const byOperation = mcpToolsByOperation();
    for (const row of PUBLIC_PARITY) {
      expect({
        operationId: row.operationId,
        hasTools: byOperation.has(row.operationId),
        hasGap: row.mcp !== undefined,
      }).toEqual({
        operationId: row.operationId,
        hasTools: !row.mcp,
        hasGap: !byOperation.has(row.operationId),
      });
    }
  });

  test("every Raycast AI tool is in the table", () => {
    const listed = PUBLIC_PARITY.flatMap((row) => row.raycast ?? []);
    const { files, manifest } = raycastTools();
    expect([...listed].sort()).toEqual([...files].sort());
    expect([...manifest].sort()).toEqual([...files].sort());
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
      for (const surface of [mcpSurface(row), row.sdk, row.cli]) {
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
    expect(PUBLIC_API_OPERATION_IDS.filter((id) => setter.test(id))).toEqual(
      []
    );
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
    const api = new Set<string>([
      ...PUBLIC_API_ERROR_CODES,
      ...APP_ONLY_CARD_ERROR_CODES,
    ]);
    expect(
      Object.values(CARD_ERROR_CODES).filter((code) => !api.has(code))
    ).toEqual([]);
  });

  test("the card list filters match on the API, MCP, SDK and CLI", () => {
    const params = Object.keys(CARD_LIST_PARAMS) as CardListParam[];
    const mcpList = TEAK_V1_TOOLS.find(
      (tool) => tool.name === "teak_v1_list_cards"
    );
    if (!mcpList) {
      throw new Error("teak_v1_list_cards is missing");
    }
    const mcpFields = mcpList.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(mcpFields).sort()).toEqual([...params].sort());

    const sent = new URLSearchParams(
      buildCardsSearchParams({
        archived: "only",
        createdAfter: 1,
        createdBefore: 2,
        cursor: "c",
        favorited: true,
        folder: "f",
        hex: "#112233",
        hue: "blue",
        include: "content",
        limit: 5,
        mode: "keyword",
        pinned: true,
        query: "q",
        shuffleSeed: 1,
        similarTo: "card_1",
        sort: "shuffle",
        style: "minimal",
        tag: "t",
        trashed: true,
        type: "link",
      })
    );
    expect([...new Set(sent.keys())].sort()).toEqual([...params].sort());

    const ls = program.commands.find((command) => command.name() === "ls");
    const flags = new Set(ls?.options.map((option) => option.long));
    expect(params.map(cliFlagFor).filter((flag) => !flags.has(flag))).toEqual(
      []
    );
  });
});
