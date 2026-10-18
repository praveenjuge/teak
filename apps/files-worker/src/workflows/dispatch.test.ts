import { describe, expect, test } from "bun:test";
import { buildWorkflowDispatchSigningPayload } from "@teak/files-protocol";
import { workflowRpcSecret } from "../convexRpc";
import { hmacSha256Hex, sha256Hex } from "../lib";
import { fakeConvexEnv, TEST_CONVEX_SITE_URL } from "../test/fakeConvex";
import { type ObjectDeletionMessage, runDispatch } from "./dispatch";

const fileKey = "users/u1/cards/c1/file/a.png";

const signed = async (
  items: unknown[],
  options: { convexSiteUrl?: string; secretFor?: string } = {}
) => {
  const convexSiteUrl = options.convexSiteUrl ?? TEST_CONVEX_SITE_URL;
  const secret = await workflowRpcSecret(
    {
      ...fakeConvexEnv,
      CONVEX_SITE_URLS: `${TEST_CONVEX_SITE_URL},https://dev.convex.site`,
    },
    options.secretFor ?? convexSiteUrl
  );
  const expiresAt = String(Math.floor(Date.now() / 1000) + 60);
  const signature = await hmacSha256Hex(
    secret ?? "",
    buildWorkflowDispatchSigningPayload({
      convexSiteUrl,
      expiresAt,
      itemsSha256: await sha256Hex(JSON.stringify(items)),
    })
  );
  return { convexSiteUrl, expiresAt, items, signature };
};

const fakeWorkflow = (
  options: {
    errors?: Array<{ code: number; index: number; message: string }>;
    statuses?: Record<string, string>;
  } = {}
) => {
  const created: Array<{ id: string; params: unknown }> = [];
  const terminated: string[] = [];
  const binding = {
    createBatch: (batch: {
      instances: Array<{ id: string; params: unknown }>;
    }) => {
      created.push(...batch.instances);
      return Promise.resolve({ created: [], errors: options.errors ?? [] });
    },
    get: (id: string) => {
      const status = options.statuses?.[id];
      if (!status) {
        return Promise.reject(new Error("instance.not_found"));
      }
      return Promise.resolve({
        status: () => Promise.resolve({ status }),
        terminate: () => {
          terminated.push(id);
          return Promise.resolve();
        },
      });
    },
  };
  return { binding: binding as unknown as Workflow, created, terminated };
};

const fakeQueue = (fail = false) => {
  const sent: ObjectDeletionMessage[] = [];
  const queue = {
    sendBatch: (messages: Array<{ body: ObjectDeletionMessage }>) => {
      if (fail) {
        return Promise.reject(new Error("queue_down"));
      }
      sent.push(...messages.map((message) => message.body));
      return Promise.resolve();
    },
  };
  return { queue: queue as unknown as Queue<ObjectDeletionMessage>, sent };
};

describe("runDispatch", () => {
  test("starts workflows with the dispatching deployment in their params", async () => {
    const cards = fakeWorkflow();
    const result = await runDispatch(
      { ...fakeConvexEnv, CARD_PROCESSING: cards.binding },
      await signed([
        {
          id: "card-abc-2",
          params: { cardId: "abc", rev: 2 },
          type: "workflow",
          workflow: "card-processing",
        },
      ])
    );
    expect(result.results).toEqual([{ index: 0, ok: true }]);
    expect(cards.created).toEqual([
      {
        id: "card-abc-2",
        params: { cardId: "abc", convexSiteUrl: TEST_CONVEX_SITE_URL, rev: 2 },
      },
    ]);
  });

  test("counts an instance that already exists as started", async () => {
    const cards = fakeWorkflow({
      errors: [{ code: 10_405, index: 0, message: "exists" }],
    });
    const result = await runDispatch(
      { ...fakeConvexEnv, CARD_PROCESSING: cards.binding },
      await signed([
        {
          id: "card-abc-2",
          params: {},
          type: "workflow",
          workflow: "card-processing",
        },
      ])
    );
    expect(result.results).toEqual([{ index: 0, ok: true }]);
  });

  test("reports other creation errors per item", async () => {
    const cards = fakeWorkflow({
      errors: [{ code: 10_001, index: 1, message: "rate limited" }],
    });
    const result = await runDispatch(
      { ...fakeConvexEnv, CARD_PROCESSING: cards.binding },
      await signed(
        ["card-a-1", "card-b-1"].map((id) => ({
          id,
          params: {},
          type: "workflow",
          workflow: "card-processing",
        }))
      )
    );
    expect(result.results).toEqual([
      { index: 0, ok: true },
      { error: "rate limited", index: 1, ok: false },
    ]);
  });

  test("stops a replaced run that is still going, and skips finished ones", async () => {
    const cards = fakeWorkflow({
      statuses: { "card-a-1": "running", "card-a-2": "complete" },
    });
    await runDispatch(
      { ...fakeConvexEnv, CARD_PROCESSING: cards.binding },
      await signed([
        {
          id: "card-a-3",
          params: {},
          terminate: ["card-a-1", "card-a-2", "card-a-0"],
          type: "workflow",
          workflow: "card-processing",
        },
      ])
    );
    expect(cards.terminated).toEqual(["card-a-1"]);
    expect(cards.created.map((instance) => instance.id)).toEqual(["card-a-3"]);
  });

  test("queues object deletions", async () => {
    const queue = fakeQueue();
    const result = await runDispatch(
      { ...fakeConvexEnv, OBJECT_DELETIONS: queue.queue },
      await signed([
        { keys: [fileKey], type: "delete-objects" },
        { keys: [`dev/${fileKey}`], type: "delete-objects" },
      ])
    );
    expect(result.results).toEqual([
      { index: 0, ok: true },
      { index: 1, ok: true },
    ]);
    expect(queue.sent).toEqual([
      { keys: [fileKey] },
      { keys: [`dev/${fileKey}`] },
    ]);
  });

  test("fails items it cannot place without failing the others", async () => {
    const queue = fakeQueue(true);
    const result = await runDispatch(
      { ...fakeConvexEnv, OBJECT_DELETIONS: queue.queue },
      await signed([
        { keys: [fileKey], type: "delete-objects" },
        { keys: ["/etc/passwd"], type: "delete-objects" },
        {
          id: "export-j1",
          params: {},
          type: "workflow",
          workflow: "export",
        },
      ])
    );
    expect(result.results).toEqual([
      { error: "queue_down", index: 0, ok: false },
      { error: "invalid_item", index: 1, ok: false },
      { error: "workflow_missing", index: 2, ok: false },
    ]);
  });

  test("refuses a deployment this Worker doesn't serve", async () => {
    await expect(
      runDispatch(
        fakeConvexEnv,
        await signed([{ keys: [fileKey], type: "delete-objects" }], {
          convexSiteUrl: "https://elsewhere.convex.site",
        })
      )
    ).rejects.toThrow("invalid_convex_site_url");
  });

  test("refuses work for one deployment signed by another", async () => {
    const queue = fakeQueue();
    const env = {
      ...fakeConvexEnv,
      CONVEX_SITE_URLS: `${TEST_CONVEX_SITE_URL},https://dev.convex.site`,
      OBJECT_DELETIONS: queue.queue,
    };
    await expect(
      runDispatch(
        env,
        await signed([{ keys: [fileKey], type: "delete-objects" }], {
          secretFor: "https://dev.convex.site",
        })
      )
    ).rejects.toThrow("invalid_dispatch_proof");
    const unsigned = await signed([
      { keys: [fileKey], type: "delete-objects" },
    ]);
    await expect(
      runDispatch(env, { ...unsigned, signature: undefined })
    ).rejects.toThrow("invalid_dispatch_proof");
    await expect(
      runDispatch(env, {
        ...unsigned,
        items: [{ keys: [`dev/${fileKey}`], type: "delete-objects" }],
      })
    ).rejects.toThrow("invalid_dispatch_proof");
    await expect(
      runDispatch(env, unsigned, Date.now() + 10 * 60 * 1000)
    ).rejects.toThrow("invalid_dispatch_proof");
    expect(queue.sent).toEqual([]);
  });
});
