import { describe, expect, test } from "bun:test";
import { internal } from "@teak/convex/_generated/api";
import { hasValidWorkflowRpcSignature } from "@teak/convex/workflowGateway";
import { allowedConvexSiteUrl, createConvexRpc } from "./convexRpc";
import {
  createFakeConvex,
  FakeConvexError,
  fakeConvexEnv,
  TEST_CONVEX_SITE_URL,
  TEST_SIGNING_SECRET,
} from "./test/fakeConvex";

const complete = internal.workflowDispatch.complete;

describe("createConvexRpc", () => {
  test("signs requests the Convex gateway accepts", async () => {
    let verified = false;
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new TextEncoder().encode(String(init?.body));
      verified = await hasValidWorkflowRpcSignature(
        new Headers(init?.headers),
        body.buffer as ArrayBuffer,
        TEST_SIGNING_SECRET
      );
      return Response.json({ ok: true, value: null });
    }) as typeof fetch;
    const rpc = createConvexRpc(fakeConvexEnv, TEST_CONVEX_SITE_URL, fetcher);
    await rpc.mutation(complete, {
      instanceId: "card-a-1",
      status: "complete",
    });
    expect(verified).toBe(true);
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
