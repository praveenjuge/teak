// @ts-nocheck
import { afterEach, describe, expect, mock, test } from "bun:test";
import { mcpV1 } from "../mcp";

type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: number;
  result: {
    tools?: Array<{ name: string }>;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
};

const sampleCard = {
  _id: "card_1",
  aiSummary: null,
  aiTags: [],
  content: "https://example.com",
  createdAt: 1,
  isFavorited: true,
  metadataDescription: null,
  metadataTitle: "Example",
  notes: null,
  tags: [],
  type: "link",
  updatedAt: 2,
  url: "https://example.com",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const runMcp = async (
  ctx: any,
  body: Record<string, unknown>,
  options?: {
    path?: "/mcp" | "/mcp/";
    authorization?: string;
  }
): Promise<Response> => {
  const handler = (mcpV1 as any).handler ?? mcpV1;
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  });

  if (options?.authorization !== undefined) {
    headers.set("Authorization", options.authorization);
  }

  return handler(
    ctx,
    new Request(`https://api.teakvault.com${options?.path ?? "/mcp"}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
};

const initializeMcp = (
  ctx: any,
  options?: {
    path?: "/mcp" | "/mcp/";
    authorization?: string;
  }
) =>
  runMcp(
    ctx,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "teak-api-tests",
          version: "1.0.0",
        },
      },
    },
    options
  );

const buildCtx = () => {
  let tokenMutationCount = 0;

  return {
    runMutation: mock(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("token" in args) {
        tokenMutationCount += 1;
        return tokenMutationCount % 2 === 1
          ? { ok: true, retryAt: undefined }
          : {
              keyId: "key_1",
              userId: "user_1",
              access: "full_access",
            };
      }

      if ("endpoint" in args && "outcome" in args) {
        return null;
      }

      if ("content" in args && "userId" in args) {
        return {
          status: "created",
          cardId: "card_1",
          card: { ...sampleCard, content: args.content },
        };
      }

      if ("isFavorited" in args && "cardId" in args) {
        return { ...sampleCard, isFavorited: args.isFavorited };
      }

      if (
        "cardId" in args &&
        ("content" in args ||
          "url" in args ||
          "notes" in args ||
          "tags" in args)
      ) {
        return { ...sampleCard, ...args };
      }

      if ("cardId" in args && "userId" in args) {
        return null;
      }

      throw new Error("Unexpected mutation");
    }),
    runQuery: mock(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("limit" in args) {
        return [sampleCard];
      }

      if ("cardId" in args && !("userId" in args)) {
        return args.cardId;
      }

      if ("cardId" in args && "userId" in args) {
        return sampleCard;
      }

      throw new Error("Unexpected query");
    }),
  };
};

const buildInvalidApiKeyCtx = () => {
  let tokenMutationCount = 0;

  return {
    runMutation: mock(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("token" in args) {
        tokenMutationCount += 1;
        return tokenMutationCount % 2 === 1
          ? { ok: true, retryAt: undefined }
          : null;
      }

      throw new Error("Unexpected mutation");
    }),
    runQuery: mock(),
  };
};

const buildRateLimitedToolCtx = () => {
  let tokenMutationCount = 0;

  return {
    runMutation: mock(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("token" in args) {
        tokenMutationCount += 1;
        if (tokenMutationCount === 1) {
          return { ok: true, retryAt: undefined };
        }
        if (tokenMutationCount === 2) {
          return {
            keyId: "key_1",
            userId: "user_1",
            access: "full_access",
          };
        }
        return { ok: false, retryAt: 123 };
      }

      throw new Error("Unexpected mutation");
    }),
    runQuery: mock(),
  };
};

describe("Convex MCP endpoint", () => {
  test("returns 401 for missing authorization", async () => {
    const response = await initializeMcp(buildCtx());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      error: "Missing or invalid Authorization header",
    });
  });

  test("returns 401 for invalid API key on control methods", async () => {
    const response = await initializeMcp(buildInvalidApiKeyCtx(), {
      authorization: "Bearer teakapi_invalid",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "INVALID_API_KEY",
      error: "Invalid or revoked API key",
    });
  });

  test("supports /mcp and /mcp/ paths", async () => {
    const response = await initializeMcp(buildCtx(), {
      authorization: "Bearer teakapi_supports",
      path: "/mcp/",
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as JsonRpcSuccess;
    expect(payload.result).toBeDefined();
  });

  test("initializes and lists the six teak_v1 tools", async () => {
    const ctx = buildCtx();
    const authorization = "Bearer teakapi_list";
    await initializeMcp(ctx, { authorization });

    const listResponse = await runMcp(
      ctx,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      { authorization }
    );

    expect(listResponse.status).toBe(200);
    const payload = (await listResponse.json()) as JsonRpcSuccess;
    const names = (payload.result.tools ?? []).map((tool) => tool.name).sort();

    expect(names).toEqual([
      "teak_v1_create_card",
      "teak_v1_delete_card",
      "teak_v1_list_favorite_cards",
      "teak_v1_search_cards",
      "teak_v1_set_card_favorite",
      "teak_v1_update_card",
    ]);
  });

  test("executes each MCP tool through the shared public API behavior", async () => {
    const ctx = buildCtx();
    const authorization = "Bearer teakapi_forward";
    await initializeMcp(ctx, { authorization });

    const toolCalls = [
      {
        id: 10,
        name: "teak_v1_create_card",
        arguments: { content: "https://example.com" },
      },
      {
        id: 11,
        name: "teak_v1_search_cards",
        arguments: { q: "design", limit: 10 },
      },
      {
        id: 12,
        name: "teak_v1_list_favorite_cards",
        arguments: { q: "design", limit: 5 },
      },
      {
        id: 13,
        name: "teak_v1_update_card",
        arguments: { cardId: "card_1", notes: null, tags: [] },
      },
      {
        id: 14,
        name: "teak_v1_set_card_favorite",
        arguments: { cardId: "card_1", isFavorited: true },
      },
      {
        id: 15,
        name: "teak_v1_delete_card",
        arguments: { cardId: "card_1", confirm: true },
      },
    ] as const;

    for (const toolCall of toolCalls) {
      const response = await runMcp(
        ctx,
        {
          jsonrpc: "2.0",
          id: toolCall.id,
          method: "tools/call",
          params: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        },
        { authorization }
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as JsonRpcSuccess;
      expect(payload.result.isError).toBeUndefined();

      if (toolCall.name === "teak_v1_delete_card") {
        expect(payload.result.structuredContent).toEqual({
          status: "deleted",
          cardId: "card_1",
        });
      }
    }
  });

  test("requires confirm=true for delete tool", async () => {
    const ctx = buildCtx();
    const authorization = "Bearer teakapi_delete_confirm";
    await initializeMcp(ctx, { authorization });

    const response = await runMcp(
      ctx,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "teak_v1_delete_card",
          arguments: { cardId: "card_1" },
        },
      },
      { authorization }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as JsonRpcSuccess;
    expect(payload.result.isError).toBe(true);
    const text = payload.result.content?.[0]?.text ?? "";
    expect(text.toLowerCase()).toContain("confirm");
  });

  test("maps public API errors to MCP isError payload", async () => {
    const ctx = buildRateLimitedToolCtx();
    const authorization = "Bearer teakapi_rate_limit";

    const response = await runMcp(
      ctx,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "teak_v1_create_card",
          arguments: { content: "hello" },
        },
      },
      { authorization }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as JsonRpcSuccess;
    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      error: "Too many requests",
    });
  });
});
