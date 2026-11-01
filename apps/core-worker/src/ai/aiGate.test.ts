import { describe, expect, test } from "bun:test";
import { createConvexRpc } from "../convexRpc";
import {
  createFakeConvex,
  FakeConvexError,
  fakeConvexEnv,
  TEST_CONVEX_SITE_URL,
} from "../test/fakeConvex";
import { AI_GATE_TTL_MS, type AiGateMemo, createAiGateReader } from "./aiGate";

const createMemoryCache = (
  failures: { match?: boolean; put?: boolean } = {}
) => {
  const entries = new Map<string, string>();
  const cache = {
    match: (request: Request) => {
      if (failures.match) {
        return Promise.reject(new Error("cache unavailable"));
      }
      const body = entries.get(request.url);
      return Promise.resolve(
        body === undefined ? undefined : new Response(body)
      );
    },
    put: async (request: Request, response: Response) => {
      if (failures.put) {
        throw new Error("cache unavailable");
      }
      entries.set(request.url, await response.text());
    },
  } as unknown as Cache;
  return { cache, entries };
};

const setup = (
  options: {
    cache?: Cache | null;
    gate?: () => unknown;
    memo?: AiGateMemo;
  } = {}
) => {
  let gate = options.gate ?? (() => "allowed");
  const convex = createFakeConvex({
    "adminAccess:getAiGate": () => gate(),
  });
  const clock = { now: 1_000_000 };
  const memo = options.memo ?? new Map();
  const read = createAiGateReader(
    createConvexRpc(fakeConvexEnv, TEST_CONVEX_SITE_URL, convex.fetcher),
    TEST_CONVEX_SITE_URL,
    {
      cache: () => Promise.resolve(options.cache ?? null),
      memo,
      now: () => clock.now,
    }
  );
  return {
    clock,
    memo,
    read,
    rpcCalls: () => convex.callsTo("adminAccess:getAiGate").length,
    setGate: (next: () => unknown) => {
      gate = next;
    },
  };
};

describe("AI gate", () => {
  test("reuses an answer for a minute, then reads the pause", async () => {
    const gates = setup();

    expect(await gates.read("user_1")).toBe("allowed");
    gates.setGate(() => "paused");
    gates.clock.now += AI_GATE_TTL_MS - 1;
    expect(await gates.read("user_1")).toBe("allowed");
    expect(gates.rpcCalls()).toBe(1);

    gates.clock.now += 1;
    expect(await gates.read("user_1")).toBe("paused");
    expect(gates.rpcCalls()).toBe(2);
  });

  test("each account has its own answer", async () => {
    const gates = setup({ gate: () => "user_disabled" });

    expect(await gates.read("user_1")).toBe("user_disabled");
    gates.setGate(() => "allowed");
    expect(await gates.read("user_2")).toBe("allowed");
    expect(gates.rpcCalls()).toBe(2);
  });

  test("another isolate in the data center reads the cached answer", async () => {
    const { cache } = createMemoryCache();
    const first = setup({ cache, gate: () => "paused" });
    expect(await first.read("user_1")).toBe("paused");

    const second = setup({ cache, gate: () => "allowed" });
    expect(await second.read("user_1")).toBe("paused");
    expect(second.rpcCalls()).toBe(0);
  });

  test("a cached answer is never kept past the minute Convex gave it", async () => {
    const { cache } = createMemoryCache();
    const first = setup({ cache, gate: () => "paused" });
    await first.read("user_1");

    const second = setup({ cache, gate: () => "allowed" });
    second.clock.now += AI_GATE_TTL_MS;
    expect(await second.read("user_1")).toBe("allowed");
    expect(second.rpcCalls()).toBe(1);
  });

  test("a cache that fails falls back to Convex", async () => {
    const { cache } = createMemoryCache({ match: true, put: true });
    const gates = setup({ cache, gate: () => "paused" });

    expect(await gates.read("user_1")).toBe("paused");
    expect(gates.rpcCalls()).toBe(1);
  });

  test("a Convex failure throws and is not remembered", async () => {
    const { cache, entries } = createMemoryCache();
    const gates = setup({
      cache,
      gate: () => {
        throw new FakeConvexError("database busy");
      },
    });

    await expect(gates.read("user_1")).rejects.toThrow("database busy");
    expect(entries.size).toBe(0);

    gates.setGate(() => "allowed");
    expect(await gates.read("user_1")).toBe("allowed");
    expect(gates.rpcCalls()).toBe(2);
  });
});
