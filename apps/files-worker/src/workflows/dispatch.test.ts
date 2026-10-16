import { describe, expect, test } from "bun:test";
import { fakeConvexEnv, TEST_CONVEX_SITE_URL } from "../test/fakeConvex";
import { type ObjectDeletionMessage, runDispatch } from "./dispatch";

const fileKey = "users/u1/cards/c1/file/a.png";

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
      {
        convexSiteUrl: TEST_CONVEX_SITE_URL,
        items: [
          {
            id: "card-abc-2",
            params: { cardId: "abc", rev: 2 },
            type: "workflow",
            workflow: "card-processing",
          },
        ],
      }
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
      {
        convexSiteUrl: TEST_CONVEX_SITE_URL,
        items: [
          {
            id: "card-abc-2",
            params: {},
            type: "workflow",
            workflow: "card-processing",
          },
        ],
      }
    );
    expect(result.results).toEqual([{ index: 0, ok: true }]);
  });

  test("reports other creation errors per item", async () => {
    const cards = fakeWorkflow({
      errors: [{ code: 10_001, index: 1, message: "rate limited" }],
    });
    const result = await runDispatch(
      { ...fakeConvexEnv, CARD_PROCESSING: cards.binding },
      {
        convexSiteUrl: TEST_CONVEX_SITE_URL,
        items: ["card-a-1", "card-b-1"].map((id) => ({
          id,
          params: {},
          type: "workflow",
          workflow: "card-processing",
        })),
      }
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
      {
        convexSiteUrl: TEST_CONVEX_SITE_URL,
        items: [
          {
            id: "card-a-3",
            params: {},
            terminate: ["card-a-1", "card-a-2", "card-a-0"],
            type: "workflow",
            workflow: "card-processing",
          },
        ],
      }
    );
    expect(cards.terminated).toEqual(["card-a-1"]);
    expect(cards.created.map((instance) => instance.id)).toEqual(["card-a-3"]);
  });

  test("queues object deletions", async () => {
    const queue = fakeQueue();
    const result = await runDispatch(
      { ...fakeConvexEnv, OBJECT_DELETIONS: queue.queue },
      {
        convexSiteUrl: TEST_CONVEX_SITE_URL,
        items: [
          { keys: [fileKey], type: "delete-objects" },
          // The development deployment's keys share this Worker.
          { keys: [`dev/${fileKey}`], type: "delete-objects" },
        ],
      }
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
      {
        convexSiteUrl: TEST_CONVEX_SITE_URL,
        items: [
          { keys: [fileKey], type: "delete-objects" },
          { keys: ["/etc/passwd"], type: "delete-objects" },
          {
            id: "export-j1",
            params: {},
            type: "workflow",
            workflow: "export",
          },
        ],
      }
    );
    expect(result.results).toEqual([
      { error: "queue_down", index: 0, ok: false },
      { error: "invalid_item", index: 1, ok: false },
      { error: "workflow_missing", index: 2, ok: false },
    ]);
  });

  test("refuses a deployment this Worker doesn't serve", async () => {
    await expect(
      runDispatch(fakeConvexEnv, {
        convexSiteUrl: "https://elsewhere.convex.site",
        items: [{ keys: [fileKey], type: "delete-objects" }],
      })
    ).rejects.toThrow("invalid_convex_site_url");
  });
});
