import {
  signWorkflowRpcRequest,
  WORKFLOW_RPC_PATH,
  WORKFLOW_RPC_TTL_SECONDS,
  type WorkflowRpcResponse,
} from "@teak/files-protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { newBackend } from "./helpers.testUtils";

const SECRET = "workflow-rpc-test-secret";
const FILES_SECRET = "files-signing-test-secret";
const SITE_URL = "https://prod-deployment.convex.site";

const signedRequest = async (
  payload: unknown,
  options: {
    convexSiteUrl?: string;
    expiresInSeconds?: number;
    secret?: string;
  } = {}
): Promise<RequestInit> => {
  const body = JSON.stringify(payload);
  // Signing "now" is moved so the request expires when the test asks.
  const nowSeconds =
    Math.floor(Date.now() / 1000) +
    (options.expiresInSeconds ?? 60) -
    WORKFLOW_RPC_TTL_SECONDS;
  const { headers } = await signWorkflowRpcRequest(
    {
      body,
      convexSiteUrl: options.convexSiteUrl ?? SITE_URL,
      secret: options.secret ?? SECRET,
    },
    nowSeconds
  );
  return { body, headers, method: "POST" };
};

const setup = async () => {
  const t = newBackend();
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
  vi.stubEnv("WORKFLOW_RPC_SECRET", SECRET);
  vi.stubEnv("FILES_SIGNING_SECRET", FILES_SECRET);
  vi.stubEnv("CONVEX_SITE_URL", SITE_URL);
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
    ["the files signing secret", { secret: FILES_SECRET }],
    [
      "a signature for another deployment",
      { convexSiteUrl: "https://dev-deployment.convex.site" },
    ],
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

  test("stays closed until the deployment has its own RPC secret", async () => {
    vi.stubEnv("WORKFLOW_RPC_SECRET", "");
    const { cardId, t } = await setup();
    const response = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest(completeCall(`card-${cardId}-2`), {
        secret: FILES_SECRET,
      })
    );
    expect(response.status).toBe(503);
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

  test("refuses a card processing write sent without its run's guard", async () => {
    const { cardId, t } = await setup();
    const response = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest({
        args: { cardId, stages: ["metadata"] },
        kind: "mutation",
        name: "card/processingRpc:markStagesInProgress",
      })
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "guard_required" });
  });

  test("runs the same write when it carries the guard", async () => {
    const { cardId, t } = await setup();
    const response = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest({
        args: { cardId, stages: ["metadata"] },
        guard: { cardId, rev: 2 },
        kind: "mutation",
        name: "card/processingRpc:markStagesInProgress",
      })
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as WorkflowRpcResponse).ok).toBe(true);
  });

  describe("batches", () => {
    const markOp = (cardId: string, stages: string[] = ["metadata"]) => ({
      args: { cardId, stages },
      kind: "mutation",
      name: "card/processingRpc:markStagesInProgress",
    });
    const readOp = (cardId: string) => ({
      args: { cardId },
      kind: "query",
      name: "card/processingRpc:getCardForProcessing",
    });
    const send = async (
      t: Awaited<ReturnType<typeof setup>>["t"],
      body: unknown
    ) => await t.fetch(WORKFLOW_RPC_PATH, await signedRequest(body));
    const dispatchState = (
      t: Awaited<ReturnType<typeof setup>>["t"],
      dispatchId: Awaited<ReturnType<typeof setup>>["dispatchId"]
    ) =>
      t.run(
        async (ctx) =>
          (await ctx.db.get("workflowDispatches", dispatchId))?.state
      );

    test("runs every op in order and answers each one's value", async () => {
      const { cardId, dispatchId, t } = await setup();
      const response = await send(t, {
        guard: { cardId, rev: 2 },
        kind: "batch",
        ops: [markOp(cardId), readOp(cardId), completeCall(`card-${cardId}-2`)],
      });
      const body = (await response.json()) as WorkflowRpcResponse;
      expect(body.ok).toBe(true);
      const values = (body.ok ? body.value : []) as Array<{
        card?: { processingStatus?: { metadata?: { status: string } } };
      } | null>;
      expect(values).toHaveLength(3);
      // The read sees the write before it, in the same transaction.
      expect(values[1]?.card?.processingStatus?.metadata?.status).toBe(
        "in_progress"
      );
      expect(await dispatchState(t, dispatchId)).toBe("done");
    });

    test("a replaced revision applies none of the batch", async () => {
      const { cardId, dispatchId, t } = await setup();
      const response = await send(t, {
        guard: { cardId, rev: 1 },
        kind: "batch",
        ops: [markOp(cardId), completeCall(`card-${cardId}-2`)],
      });
      const body = (await response.json()) as WorkflowRpcResponse;
      expect(!body.ok && body.error.code).toBe("stale_processing_revision");
      expect(await dispatchState(t, dispatchId)).toBe("sent");
      const card = await t.run((ctx) => ctx.db.get("cards", cardId));
      expect(card?.processingStatus?.metadata).toBeUndefined();
    });

    test("an op that fails rolls back the ones before it and is named", async () => {
      const { cardId, dispatchId, t } = await setup();
      const response = await send(t, {
        guard: { cardId, rev: 2 },
        kind: "batch",
        ops: [
          completeCall(`card-${cardId}-2`),
          markOp(cardId, ["not_a_stage"]),
        ],
      });
      const body = (await response.json()) as WorkflowRpcResponse;
      expect(body.ok).toBe(false);
      expect(!body.ok && body.error.index).toBe(1);
      expect(await dispatchState(t, dispatchId)).toBe("sent");
    });

    test("reads alone run as a query, without a guard", async () => {
      const { cardId, t } = await setup();
      const response = await send(t, {
        kind: "batch",
        ops: [
          readOp(cardId),
          { args: {}, kind: "query", name: "adminAccess:isLinkFetchPaused" },
        ],
      });
      const body = (await response.json()) as WorkflowRpcResponse;
      expect(body.ok).toBe(true);
      expect((body.ok ? body.value : []) as unknown[]).toHaveLength(2);
    });

    test("refuses the batch when any op is outside the allowlist", async () => {
      const { cardId, dispatchId, t } = await setup();
      const response = await send(t, {
        guard: { cardId, rev: 2 },
        kind: "batch",
        ops: [
          completeCall(`card-${cardId}-2`),
          { args: {}, kind: "mutation", name: "cards:deleteCard" },
        ],
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "function_not_allowed" });
      expect(await dispatchState(t, dispatchId)).toBe("sent");
    });

    test("refuses a guarded write to a card other than the guard's", async () => {
      const { cardId, t } = await setup();
      const other = await t.run((ctx) =>
        ctx.db.insert("cards", {
          content: "Other",
          createdAt: Date.now(),
          processingRev: 1,
          type: "text",
          updatedAt: Date.now(),
          userId: "user-1",
        })
      );
      const response = await send(t, {
        guard: { cardId, rev: 2 },
        kind: "batch",
        ops: [markOp(cardId), markOp(other)],
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "guard_mismatch" });
      const card = await t.run((ctx) => ctx.db.get("cards", cardId));
      expect(card?.processingStatus?.metadata).toBeUndefined();
    });

    test("names the op whose args can't be decoded", async () => {
      const { cardId, t } = await setup();
      const response = await send(t, {
        kind: "batch",
        ops: [
          readOp(cardId),
          { ...readOp(cardId), args: { cardId: { $bytes: 5 } } },
        ],
      });
      const body = (await response.json()) as WorkflowRpcResponse;
      expect(body.ok).toBe(false);
      expect(!body.ok && body.error.index).toBe(1);
    });

    test("refuses a card processing write in a batch without a guard", async () => {
      const { cardId, t } = await setup();
      const response = await send(t, {
        kind: "batch",
        ops: [readOp(cardId), markOp(cardId)],
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "guard_required" });
    });
  });

  test("lets a run forget a podcast file it deleted without a guard, but not record one", async () => {
    const { cardId, t } = await setup();
    const call = (stored: boolean) => ({
      args: { cardId, key: "users/user-1/cards/c/audio/a.mp3", stored },
      kind: "mutation",
      name: "workflows/steps/podcast/mutations:trackPodcastAudio",
    });
    const forget = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest(call(false))
    );
    expect(forget.status).toBe(200);
    const record = await t.fetch(
      WORKFLOW_RPC_PATH,
      await signedRequest(call(true))
    );
    expect(record.status).toBe(403);
  });
});
