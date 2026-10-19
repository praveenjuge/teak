import { describe, expect, test } from "bun:test";
import { internal } from "@teak/convex/_generated/api";
import { hasValidWorkflowRpcSignature } from "@teak/convex/workflowGateway";
import {
  allowedConvexSiteUrl,
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
  await hasValidWorkflowRpcSignature(
    new Headers(init?.headers),
    new TextEncoder().encode(String(init?.body)).buffer as ArrayBuffer,
    secret,
    origin
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
