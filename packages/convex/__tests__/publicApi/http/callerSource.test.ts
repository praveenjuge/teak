import { describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { cardSourceForCaller } from "../../../publicApi/http/callerSource";
import { executePublicApiOperation } from "../../../publicApi/http/router";
import { mockActionCtx } from "../../helpers/convex.test-utils";
import {
  buildAuthorizedMutationMock,
  callPublicApi,
} from "../../helpers/publicApiHttp.test-utils";
import { withMappedOwner } from "../../helpers/session.test-utils";

const TOKEN = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
const CLIENTS = {
  client_cli: "cli",
  client_raycast: "raycast",
  client_chrome: "chrome",
  client_firefox: "firefox",
} as const;

describe("cardSourceForCaller", () => {
  test.each([
    ["client_cli", "cli"],
    ["client_raycast", "raycast"],
    ["client_chrome", "extension"],
    ["client_firefox", "extension"],
    ["client_someone_else", "api"],
  ] as const)("an OAuth token from %s saves as %s", (clientId, source) => {
    expect(cardSourceForCaller({ clientId }, "api", CLIENTS)).toBe(source);
  });

  test("an API key saves as api", () => {
    expect(cardSourceForCaller({}, "api", CLIENTS)).toBe("api");
  });

  test("anything through the MCP server saves as mcp", () => {
    expect(
      cardSourceForCaller({ clientId: "client_cli" }, "mcp", CLIENTS)
    ).toBe("mcp");
  });
});

const savedSource = (runMutation: ReturnType<typeof mock>) =>
  runMutation.mock.calls.find(
    (call: unknown[]) =>
      getFunctionName(call[0] as never) ===
      "publicApi/cardsForUser:quickSaveForUser"
  )?.[1]?.cardSource;

const createCtx = () => {
  const runMutation = buildAuthorizedMutationMock().mockResolvedValue({
    cardId: "card_1",
    status: "created",
  });
  const ctx = mockActionCtx(
    withMappedOwner({
      runMutation,
      runQuery: mock().mockResolvedValue(null),
    } as never)
  );
  return { ctx, runMutation };
};

describe("the source a public API save reports", () => {
  test("POST /v1/cards with an API key saves as api", async () => {
    const { ctx, runMutation } = createCtx();
    const response = await callPublicApi(ctx, {
      body: { content: "A note" },
      headers: { Authorization: `Bearer ${TOKEN}` },
      method: "POST",
      path: "/v1/cards",
    });
    expect(response.status).toBe(200);
    expect(savedSource(runMutation)).toBe("api");
  });

  test("the same save through the MCP server saves as mcp", async () => {
    const { ctx, runMutation } = createCtx();
    const response = await executePublicApiOperation(
      ctx,
      {
        body: { content: "A note" },
        headers: { Authorization: `Bearer ${TOKEN}` },
        operationId: "createCard",
      },
      { origin: "https://example.com", resource: "mcp" }
    );
    expect(response.status).toBe(200);
    expect(savedSource(runMutation)).toBe("mcp");
  });
});
