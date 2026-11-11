import { describe, expect, test } from "bun:test";
import { FETCHER_BUSY_STATUS } from "../../fetcher/src/protocol";
import {
  type ContainerPool,
  containerInstanceOrder,
  containerPoolSize,
  type PoolRequest,
  postToPool,
  RendererUnavailable,
} from "./containerPool";

const poolOf = (
  answer: (instance: string) => Response,
  overrides: Partial<ContainerPool> = {}
) => {
  const instances: string[] = [];
  const namespace = {
    get: (instance: string) => ({
      fetch: (_request: Request) => {
        instances.push(instance);
        return Promise.resolve(answer(instance));
      },
    }),
    idFromName: (name: string) => name,
  } as unknown as DurableObjectNamespace;
  const pool: ContainerPool = {
    host: "fetcher",
    namespace,
    reasonPrefix: "fetcher_",
    size: 3,
    ...overrides,
  };
  return { instances, pool };
};

const request: PoolRequest = {
  body: () => Promise.resolve({ body: "{}", contentType: "application/json" }),
  path: "/fetch",
  timeoutMs: 1000,
};

const reasonOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(RendererUnavailable);
  return (error as RendererUnavailable).reason;
};

describe("container pool", () => {
  test("tries every instance once, starting at a random one", () => {
    expect(containerInstanceOrder(4, () => 0.6, "renderer")).toEqual([
      "renderer-2",
      "renderer-3",
      "renderer-0",
      "renderer-1",
    ]);
  });

  test.each([
    [undefined, 2],
    ["4", 4],
    ["0", 2],
    ["many", 2],
    ["99", 16],
  ])("reads pool size %p as %i", (value, size) => {
    expect(containerPoolSize(value)).toBe(size);
  });

  test("returns the first answer that isn't busy", async () => {
    const { instances, pool } = poolOf((instance) =>
      instance === "fetcher-1"
        ? new Response("ok")
        : new Response(null, { status: 503 })
    );
    const response = await postToPool(pool, request, () => 0);
    expect(await response.text()).toBe("ok");
    expect(instances).toEqual(["fetcher-0", "fetcher-1"]);
  });

  test("moves on when the fetcher image answers busy", async () => {
    const { instances, pool } = poolOf((instance) =>
      instance === "fetcher-1"
        ? new Response("ok")
        : Response.json({ error: "busy" }, { status: FETCHER_BUSY_STATUS })
    );
    const response = await postToPool(pool, request, () => 0);
    expect(await response.text()).toBe("ok");
    expect(instances).toEqual(["fetcher-0", "fetcher-1"]);
  });

  test("hands any other error status back without trying on", async () => {
    const { instances, pool } = poolOf(
      () => new Response("no", { status: 415 })
    );
    const response = await postToPool(pool, request, () => 0);
    expect(response.status).toBe(415);
    expect(instances).toEqual(["fetcher-0"]);
  });

  test("names the pool's busy reason when every instance is busy", async () => {
    const { instances, pool } = poolOf(
      () => new Response(null, { status: 503 })
    );
    expect(await reasonOf(postToPool(pool, request))).toBe("fetcher_busy");
    expect(instances).toHaveLength(3);
  });

  test("keeps the reason the last busy instance gave", async () => {
    const { pool } = poolOf(
      (instance) => new Response(instance, { status: 503 }),
      { host: "renderer", reasonPrefix: "" }
    );
    const busyReason = (response: Response) => response.text();
    expect(
      await reasonOf(postToPool(pool, { ...request, busyReason }, () => 0))
    ).toBe("renderer-2");
  });

  test("opens a fresh body for each instance it tries", async () => {
    let opened = 0;
    const { pool } = poolOf(() => new Response(null, { status: 503 }));
    const body = () => {
      opened += 1;
      return request.body();
    };
    await reasonOf(postToPool(pool, { ...request, body }));
    expect(opened).toBe(3);
  });

  test("is unavailable without its binding", async () => {
    const { pool } = poolOf(() => new Response("ok"), {
      namespace: undefined,
    });
    expect(await reasonOf(postToPool(pool, request))).toBe(
      "fetcher_binding_missing"
    );
  });

  test("tells a timeout from a failed request", async () => {
    const timedOut = poolOf(() => {
      throw new DOMException("slow", "TimeoutError");
    });
    const failed = poolOf(() => {
      throw new Error("reset");
    });
    expect(await reasonOf(postToPool(timedOut.pool, request))).toBe(
      "fetcher_timeout"
    );
    expect(await reasonOf(postToPool(failed.pool, request))).toBe(
      "fetcher_request_failed"
    );
  });
});
