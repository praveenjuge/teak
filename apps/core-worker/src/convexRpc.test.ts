import { describe, expect, test } from "bun:test";
import { internal } from "@teak/convex/_generated/api";
import { verifyWorkflowRpcRequest } from "@teak/files-protocol";
import {
  allowedConvexSiteUrl,
  batchOp,
  ConvexRpcError,
  createConvexRpc,
  workflowRpcSecret,
} from "./convexRpc";
import {
  createFakeConvex,
  FakeConvexError,
  fakeConvexEnv,
  TEST_CONVEX_SITE_URL,
  TEST_SIGNING_SECRET,
} from "./test/fakeConvex";

const DEV_SITE_URL = "https://dev-deployment.convex.site";
const twoDeploymentEnv = {
  ...fakeConvexEnv,
  CONVEX_SITE_URLS: `${TEST_CONVEX_SITE_URL},${DEV_SITE_URL}`,
};

const gatewayAccepts = async (
  init: RequestInit | undefined,
  origin: string,
  secret: string
) =>
  await verifyWorkflowRpcRequest(
    secret,
    origin,
    new Headers(init?.headers),
    String(init?.body)
  );

const complete = internal.workflowDispatch.complete;

describe("createConvexRpc", () => {
  test("signs requests the Convex gateway accepts", async () => {
    const secret = await workflowRpcSecret(fakeConvexEnv, TEST_CONVEX_SITE_URL);
    let verified = false;
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      verified = await gatewayAccepts(init, TEST_CONVEX_SITE_URL, secret ?? "");
      return Response.json({ ok: true, value: null });
    }) as typeof fetch;
    const rpc = createConvexRpc(fakeConvexEnv, TEST_CONVEX_SITE_URL, fetcher);
    await rpc.mutation(complete, {
      instanceId: "card-a-1",
      status: "complete",
    });
    expect(verified).toBe(true);
  });

  test("gives each deployment a secret that can't sign for another", async () => {
    const prodSecret = await workflowRpcSecret(
      twoDeploymentEnv,
      TEST_CONVEX_SITE_URL
    );
    const devSecret = await workflowRpcSecret(twoDeploymentEnv, DEV_SITE_URL);
    expect(prodSecret).not.toBe(devSecret);
    let sent: RequestInit | undefined;
    const fetcher = ((_url: RequestInfo | URL, init?: RequestInit) => {
      sent = init;
      return Promise.resolve(Response.json({ ok: true, value: null }));
    }) as typeof fetch;
    await createConvexRpc(twoDeploymentEnv, DEV_SITE_URL, fetcher).mutation(
      complete,
      { instanceId: "card-a-1", status: "complete" }
    );
    expect(await gatewayAccepts(sent, DEV_SITE_URL, devSecret ?? "")).toBe(
      true
    );
    expect(
      await gatewayAccepts(sent, TEST_CONVEX_SITE_URL, prodSecret ?? "")
    ).toBe(false);
    expect(
      await gatewayAccepts(sent, TEST_CONVEX_SITE_URL, devSecret ?? "")
    ).toBe(false);
    expect(
      await gatewayAccepts(sent, TEST_CONVEX_SITE_URL, TEST_SIGNING_SECRET)
    ).toBe(false);
  });

  test("sends the function name, kind, Convex JSON args and guard", async () => {
    const convex = createFakeConvex({
      "workflowDispatch:complete": () => null,
    });
    const rpc = createConvexRpc(
      fakeConvexEnv,
      TEST_CONVEX_SITE_URL,
      convex.fetcher
    );
    await rpc.mutation(
      complete,
      { instanceId: "card-a-2", status: "errored" },
      { guard: { cardId: "a", rev: 2 } }
    );
    expect(convex.calls).toEqual([
      {
        args: { instanceId: "card-a-2", status: "errored" },
        guard: { cardId: "a", rev: 2 },
        kind: "mutation",
        name: "workflowDispatch:complete",
      },
    ]);
  });

  test.each([["stale_processing_revision"], ["card_missing"]])(
    "stops the step without retrying on %s",
    async (code) => {
      const convex = createFakeConvex({
        "workflowDispatch:complete": () => {
          throw new FakeConvexError("refused", code);
        },
      });
      const rpc = createConvexRpc(
        fakeConvexEnv,
        TEST_CONVEX_SITE_URL,
        convex.fetcher
      );
      const call = rpc.mutation(complete, {
        instanceId: "x",
        status: "complete",
      });
      await expect(call).rejects.toMatchObject({ name: "NonRetryableError" });
    }
  );

  test("surfaces other function errors as retryable errors with their code", async () => {
    const convex = createFakeConvex({
      "workflowDispatch:complete": () => {
        throw new FakeConvexError("job busy", "busy");
      },
    });
    const rpc = createConvexRpc(
      fakeConvexEnv,
      TEST_CONVEX_SITE_URL,
      convex.fetcher
    );
    const call = rpc.mutation(complete, {
      instanceId: "x",
      status: "complete",
    });
    await expect(call).rejects.toMatchObject({
      code: "busy",
      message: "job busy",
      name: "ConvexRpcError",
    });
  });

  test("treats a refused signature or function as final", async () => {
    const rpc = createConvexRpc(
      fakeConvexEnv,
      TEST_CONVEX_SITE_URL,
      (async () =>
        Response.json({ error: "unauthorized" }, { status: 401 })) as never
    );
    await expect(
      rpc.query(internal.workflowDispatch.listStale, {})
    ).rejects.toMatchObject({ name: "NonRetryableError" });
  });

  test("retries when Convex can't be reached", async () => {
    const rpc = createConvexRpc(
      fakeConvexEnv,
      TEST_CONVEX_SITE_URL,
      (async () => new Response("bad gateway", { status: 502 })) as never
    );
    const call = rpc.query(internal.workflowDispatch.listStale, {});
    await expect(call).rejects.toThrow("convex_rpc_unavailable");
    await expect(call).rejects.not.toMatchObject({
      name: "NonRetryableError",
    });
  });

  test("refuses a deployment this Worker doesn't serve", async () => {
    let called = false;
    const rpc = createConvexRpc(
      fakeConvexEnv,
      "https://someone-else.convex.site",
      (() => {
        called = true;
        return Promise.resolve(Response.json({ ok: true, value: null }));
      }) as never
    );
    await expect(
      rpc.query(internal.workflowDispatch.listStale, {})
    ).rejects.toMatchObject({ name: "NonRetryableError" });
    expect(called).toBe(false);
  });
});

describe("ConvexRpc.batch", () => {
  const CARD = "jd7f2kz9m8w6y1v3h4n5q0r8s2t6u4x1";
  const guard = { cardId: CARD, rev: 3 };
  const ops = [
    batchOp.query(internal.card.processingRpc.getCardForProcessing, {
      cardId: CARD as never,
    }),
    batchOp.mutation(internal.card.processingRpc.markStagesInProgress, {
      cardId: CARD as never,
      stages: ["metadata"],
    }),
  ] as const;
  const handlers = {
    "card/processingRpc:getCardForProcessing": () => ({ keyPrefix: "p/" }),
    "card/processingRpc:markStagesInProgress": () => null,
  };

  test("sends the ops in one call and answers each op's value", async () => {
    const fake = createFakeConvex(handlers);
    const rpc = createConvexRpc(
      fakeConvexEnv,
      TEST_CONVEX_SITE_URL,
      fake.fetcher
    );
    expect(await rpc.batch(ops, { guard })).toEqual([
      { keyPrefix: "p/" },
      null,
    ]);
    expect(fake.requests).toHaveLength(1);
  });

  test("runs the ops one by one, the guard on each write, when Convex predates batches", async () => {
    const fake = createFakeConvex(handlers, { batches: false });
    // Every HTTP call, the refused batch included.
    let sent = 0;
    const counting = ((...request: Parameters<typeof fetch>) => {
      sent += 1;
      return fake.fetcher(...request);
    }) as typeof fetch;
    const rpc = createConvexRpc(fakeConvexEnv, TEST_CONVEX_SITE_URL, counting);
    expect(await rpc.batch(ops, { guard })).toEqual([
      { keyPrefix: "p/" },
      null,
    ]);
    expect(fake.requests).toEqual([
      "card/processingRpc:getCardForProcessing",
      "card/processingRpc:markStagesInProgress",
    ]);
    expect(fake.calls.map((call) => call.guard)).toEqual([undefined, guard]);
    expect(sent).toBe(3);
    // It remembers: the next batch doesn't try first.
    await rpc.batch(ops, { guard });
    expect(sent).toBe(5);
  });

  test("refuses a batch longer than Convex takes, without sending it", async () => {
    const fake = createFakeConvex(handlers);
    const rpc = createConvexRpc(
      fakeConvexEnv,
      TEST_CONVEX_SITE_URL,
      fake.fetcher
    );
    const tooMany = Array.from({ length: 17 }, () => ops[0]);
    await expect(rpc.batch(tooMany, { guard })).rejects.toThrow(
      "convex_rpc_batch_size:17"
    );
    expect(fake.requests).toHaveLength(0);
  });

  test("an ordinary failure keeps its message and names its op", async () => {
    const fake = createFakeConvex({
      ...handlers,
      "card/processingRpc:markStagesInProgress": () => {
        throw new FakeConvexError("no such stage", "invalid_stage");
      },
    });
    const rpc = createConvexRpc(
      fakeConvexEnv,
      TEST_CONVEX_SITE_URL,
      fake.fetcher
    );
    const error = (await rpc
      .batch(ops, { guard })
      .catch((caught) => caught)) as ConvexRpcError;
    expect(error).toBeInstanceOf(ConvexRpcError);
    expect(error.message).toBe("no such stage");
    expect(error.code).toBe("invalid_stage");
    expect(error.operation).toEndWith("#1");
  });

  test("names the op that failed, and a stale guard is final", async () => {
    const fake = createFakeConvex({
      ...handlers,
      "card/processingRpc:markStagesInProgress": () => {
        throw new FakeConvexError(
          "stale_processing_revision",
          "stale_processing_revision"
        );
      },
    });
    const rpc = createConvexRpc(
      fakeConvexEnv,
      TEST_CONVEX_SITE_URL,
      fake.fetcher
    );
    const error = await rpc.batch(ops, { guard }).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("NonRetryableError");
    expect((error as Error).message).toContain("#1");
  });
});

describe("allowedConvexSiteUrl", () => {
  test.each([
    [TEST_CONVEX_SITE_URL, TEST_CONVEX_SITE_URL],
    [`${TEST_CONVEX_SITE_URL}/`, TEST_CONVEX_SITE_URL],
    ["https://test-deployment.convex.site.evil.test", null],
    [`${TEST_CONVEX_SITE_URL}/path`, null],
    ["javascript:alert(1)", null],
    [42, null],
  ])("%p → %p", (value, expected) => {
    expect(allowedConvexSiteUrl(fakeConvexEnv, value)).toBe(expected);
  });
});
