import { describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import { executePublicApiOperation } from "../publicApiHttp";
import type { PublicApiOperation } from "../publicApiHttpShared";
import { mockActionCtx } from "./helpers/convex.test-utils";
import { buildAuthorizedMutationMock } from "./helpers/publicApiHttp.test-utils";
import { withMappedOwner } from "./helpers/session.test-utils";

const AUTH = {
  Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
};

const operation = {
  _id: "op_1",
  kind: "rename",
  from: "design",
  to: "Design Systems",
  status: "running",
  total: 300,
  processed: 0,
  changed: 0,
  createdAt: 1,
  updatedAt: 1,
};

const run = (
  request: PublicApiOperation,
  {
    query = mock().mockResolvedValue(null),
    mutation = mock().mockResolvedValue(null),
  }: {
    mutation?: ReturnType<typeof mock>;
    query?: ReturnType<typeof mock>;
  } = {}
) => {
  const runMutation = buildAuthorizedMutationMock();
  runMutation.mockImplementation((...args) => mutation(...args));
  const ctx = withMappedOwner({ runMutation, runQuery: query });
  return executePublicApiOperation(mockActionCtx(ctx), {
    headers: AUTH,
    ...request,
  });
};

const argsOf = (fn: ReturnType<typeof mock>, call = 0) =>
  fn.mock.calls[call]?.[1];

describe("public API tag changes", () => {
  test("rename, merge and delete start an operation and return 202", async () => {
    const cases = [
      {
        path: "/v1/tags/rename",
        body: { from: "Design", to: "Design Systems" },
        args: { kind: "rename", from: "Design", to: "Design Systems" },
      },
      {
        path: "/v1/tags/merge",
        body: { from: "ux", into: "research" },
        args: { kind: "merge", from: "ux", to: "research" },
      },
      {
        path: "/v1/tags/delete",
        body: { tag: "old" },
        args: { kind: "delete", from: "old" },
      },
    ];
    for (const item of cases) {
      const mutation = mock().mockResolvedValue(operation);
      const response = await run(
        { method: "POST", path: item.path, body: item.body },
        { mutation }
      );
      expect(response.status, item.path).toBe(202);
      expect(argsOf(mutation)).toMatchObject(item.args);
      expect(await response.json()).toEqual({
        operationId: "op_1",
        id: "op_1",
        kind: "rename",
        from: "design",
        to: "Design Systems",
        status: "running",
        total: 300,
        processed: 0,
        changed: 0,
        error: null,
        createdAt: 1,
        updatedAt: 1,
        completedAt: null,
      });
    }
  });

  test("refuses bad bodies before starting anything", async () => {
    const bodies: [string, unknown][] = [
      ["/v1/tags/rename", {}],
      ["/v1/tags/rename", { from: "a" }],
      ["/v1/tags/rename", { from: "a", to: "  " }],
      ["/v1/tags/rename", { from: "a", to: "x".repeat(65) }],
      ["/v1/tags/rename", { from: "a", into: "b" }],
      ["/v1/tags/merge", { from: "a", to: "b" }],
      ["/v1/tags/delete", { tag: 3 }],
      ["/v1/tags/delete", { tag: "a", extra: true }],
      ["/v1/tags/delete", ["a"]],
    ];
    for (const [path, body] of bodies) {
      const mutation = mock();
      const response = await run({ method: "POST", path, body }, { mutation });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  test("a running change, an existing name and a missing tag map to 409 and 404", async () => {
    for (const [code, status] of [
      ["TAG_OPERATION_RUNNING", 409],
      ["TAG_EXISTS", 409],
      ["NOT_FOUND", 404],
    ] as const) {
      const mutation = mock().mockRejectedValue(
        new ConvexError({ code, message: "Nope" })
      );
      const response = await run(
        {
          method: "POST",
          path: "/v1/tags/rename",
          body: { from: "a", to: "b" },
        },
        { mutation }
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code, error: "Nope" });
    }
  });

  test("polls an operation, and another user's reads as not found", async () => {
    const query = mock().mockResolvedValue({
      ...operation,
      status: "completed",
      processed: 300,
      changed: 120,
      completedAt: 5,
    });
    const found = await run(
      { method: "GET", path: "/v1/tags/operations/op_1" },
      { query }
    );
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      id: "op_1",
      status: "completed",
      changed: 120,
      completedAt: 5,
    });
    expect(argsOf(query)).toMatchObject({ operationId: "op_1" });

    const missing = await run({
      method: "GET",
      path: "/v1/tags/operations/someone-elses",
    });
    expect(missing.status).toBe(404);
  });

  test("GET /v1/tags answers live, or from the tag summary when there are too many to count", async () => {
    const live = { items: [{ name: "design", count: 2 }], isComplete: true };
    const small = mock().mockResolvedValueOnce(live);
    const fresh = await run(
      { method: "GET", path: "/v1/tags" },
      { query: small }
    );
    expect(await fresh.json()).toEqual(live);
    expect(small).toHaveBeenCalledTimes(1);

    const partial = { items: [{ name: "a", count: 1 }], isComplete: false };
    const summary = {
      items: [
        { name: "a", count: 1 },
        { name: "b", count: 1 },
      ],
      isComplete: true,
      computedAt: 5,
    };
    const large = mock()
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(summary);
    const fromSummary = await run(
      { method: "GET", path: "/v1/tags" },
      { query: large }
    );
    expect(await fromSummary.json()).toEqual({
      items: summary.items,
      isComplete: true,
    });

    // No summary yet: one is requested, and the partial list comes back.
    const none = mock()
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(null);
    const mutation = mock().mockResolvedValue(null);
    const first = await run(
      { method: "GET", path: "/v1/tags" },
      { query: none, mutation }
    );
    expect(await first.json()).toEqual(partial);
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  test("wrong methods and unknown tag routes", async () => {
    expect((await run({ method: "GET", path: "/v1/tags/rename" })).status).toBe(
      405
    );
    expect(
      (await run({ method: "POST", path: "/v1/tags/operations/op_1" })).status
    ).toBe(405);
    expect(
      (await run({ method: "GET", path: "/v1/tags/operations/" })).status
    ).toBe(404);
    // An id that isn't valid percent-encoding is not found, not a crash.
    expect(
      (await run({ method: "GET", path: "/v1/tags/operations/%E0" })).status
    ).toBe(404);
  });
});
