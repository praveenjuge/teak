/// <reference types="vite/client" />
import {
  buildWorkflowRpcSigningPayload,
  WORKFLOW_RPC_HEADERS,
  WORKFLOW_RPC_PATH,
  type WorkflowRpcResponse,
} from "@teak/files-protocol";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { hmacSha256Hex } from "./storage/r2Keys";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "workflow-rpc-test-secret";

const sha256Hex = async (text: string): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");

const signedRequest = async (
  payload: unknown,
  options: { expiresInSeconds?: number; secret?: string } = {}
): Promise<RequestInit> => {
  const body = JSON.stringify(payload);
  const requestId = crypto.randomUUID();
  const expiresAt = String(
    Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 60)
  );
  const signature = await hmacSha256Hex(
    options.secret ?? SECRET,
    buildWorkflowRpcSigningPayload({
      bodySha256: await sha256Hex(body),
      expiresAt,
      requestId,
    })
  );
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      [WORKFLOW_RPC_HEADERS.expiresAt]: expiresAt,
      [WORKFLOW_RPC_HEADERS.requestId]: requestId,
      [WORKFLOW_RPC_HEADERS.signature]: signature,
    },
    method: "POST",
  };
};

const setup = async () => {
  const t = convexTest(schema, modules);
  const { cardId, dispatchId } = await t.run(async (ctx) => {
    const now = Date.now();
    const cardId = await ctx.db.insert("cards", {
      content: "Card",
      createdAt: now,
      processingRev: 2,
      type: "text",
      updatedAt: now,
      userId: "user-1",
    });
    const dispatchId = await ctx.db.insert("workflowDispatches", {
      cardId,
      createdAt: now,
      instanceId: `card-${cardId}-2`,
      key: `card:${cardId}`,
      kind: "cardProcessing",
      notBefore: now,
      rev: 2,
      sentAt: now,
      state: "sent",
    });
    return { cardId, dispatchId };
  });
  return { cardId, dispatchId, t };
};

const completeCall = (instanceId: string) => ({
  args: { instanceId, status: "complete" },
  kind: "mutation",
  name: "workflowDispatch:complete",
});

beforeEach(() => {
  vi.stubEnv("FILES_SIGNING_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("workflow RPC gateway", () => {
  test("runs an allowlisted function for a correctly signed request", async () => {
    const { cardId, dispatchId, t } = await setup();
    const response = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest(completeCall(`card-${cardId}-2`))
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as WorkflowRpcResponse).toEqual({
      ok: true,
      value: null,
    });
    const row = await t.run((ctx) =>
      ctx.db.get("workflowDispatches", dispatchId)
    );
    expect(row?.state).toBe("done");
  });

  test.each([
    ["a different secret", { secret: "wrong-secret" }],
    ["an expired signature", { expiresInSeconds: -5 }],
    [
      "an expiry further out than the gateway allows",
      { expiresInSeconds: 3600 },
    ],
  ])("refuses %s", async (_label, options) => {
    const { cardId, dispatchId, t } = await setup();
    const response = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest(completeCall(`card-${cardId}-2`), options)
    );
    expect(response.status).toBe(401);
    const row = await t.run((ctx) =>
      ctx.db.get("workflowDispatches", dispatchId)
    );
    expect(row?.state).toBe("sent");
  });

  test("refuses a body changed after signing", async () => {
    const { cardId, t } = await setup();
    const init = await signedRequest(completeCall(`card-${cardId}-2`));
    const response = await t.fetch(WORKFLOW_RPC_PATH, {
      ...init,
      body: JSON.stringify(completeCall("card-other-1")),
    });
    expect(response.status).toBe(401);
  });

  test("refuses a function outside the allowlist", async () => {
    const { t } = await setup();
    const response = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest({
        args: { cardId: "x" },
        kind: "mutation",
        name: "card/deleteCard:permanentDeleteCard",
      })
    );
    expect(response.status).toBe(403);
  });

  test("refuses a malformed request", async () => {
    const { t } = await setup();
    const response = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest({ kind: "delete", name: "x:y" })
    );
    expect(response.status).toBe(400);
  });

  test("reports a guarded write for a replaced revision without running it", async () => {
    const { cardId, dispatchId, t } = await setup();
    const response = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest({
        ...completeCall(`card-${cardId}-2`),
        guard: { cardId, rev: 1 },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as WorkflowRpcResponse;
    expect(body.ok).toBe(false);
    expect(!body.ok && body.error.code).toBe("stale_processing_revision");
    const row = await t.run((ctx) =>
      ctx.db.get("workflowDispatches", dispatchId)
    );
    expect(row?.state).toBe("sent");
  });

  test("runs a guarded write while the revision is current", async () => {
    const { cardId, dispatchId, t } = await setup();
    const response = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest({
        ...completeCall(`card-${cardId}-2`),
        guard: { cardId, rev: 2 },
      })
    );
    expect(((await response.json()) as WorkflowRpcResponse).ok).toBe(true);
    const row = await t.run((ctx) =>
      ctx.db.get("workflowDispatches", dispatchId)
    );
    expect(row?.state).toBe("done");
  });

  test("reports a guarded write for a deleted card as card_missing", async () => {
    const { cardId, t } = await setup();
    await t.run((ctx) => ctx.db.delete("cards", cardId));
    const response = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest({
        ...completeCall(`card-${cardId}-2`),
        guard: { cardId, rev: 2 },
      })
    );
    const body = (await response.json()) as WorkflowRpcResponse;
    expect(!body.ok && body.error.code).toBe("card_missing");
  });
});
