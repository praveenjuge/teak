import {
  isWorkflowRpcFunction,
  requiresWorkflowRpcGuard,
} from "@teak/convex/workflows/rpcAllowlist";
import type {
  WorkflowRpcBatchRequest,
  WorkflowRpcRequest,
} from "@teak/files-protocol";
import { convexToJson, jsonToConvex, type Value } from "convex/values";

export const TEST_CONVEX_SITE_URL = "https://test-deployment.convex.site";
export const TEST_SIGNING_SECRET = "test-files-signing-secret";
export const TEST_RPC_ROOT_SECRET = "test-workflow-rpc-root-secret";

export const fakeConvexEnv = {
  CONVEX_SITE_URLS: TEST_CONVEX_SITE_URL,
  FILES_PUBLIC_ORIGIN: "https://files.teakvault.com",
  FILES_SIGNING_SECRET: TEST_SIGNING_SECRET,
  WORKFLOW_RPC_ROOT_SECRET: TEST_RPC_ROOT_SECRET,
};

export type FakeHandler = (
  args: Record<string, unknown>,
  request: WorkflowRpcRequest
) => unknown | Promise<unknown>;

export class FakeConvexError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const errorBody = (error: unknown, index?: number) => ({
  error: {
    ...(error instanceof FakeConvexError && error.code
      ? { code: error.code }
      : {}),
    ...(index === undefined ? {} : { index }),
    message: error instanceof Error ? error.message : String(error),
  },
  ok: false,
});

/**
 * A Convex workflow gateway for tests: answers single calls and batches
 * from `handlers`, keeps every op it ran in `calls` (a batch's guard on each
 * of its mutations, as the real gateway checks it for them), and counts the
 * HTTP calls in `requests`. With `batches: false` it answers a batch 400, as
 * a Convex from before batches does.
 */
export const createFakeConvex = (
  handlers: Record<string, FakeHandler>,
  options: { batches?: boolean } = {}
) => {
  const calls: Array<{
    args: Record<string, unknown>;
    batch?: number;
    guard?: WorkflowRpcRequest["guard"];
    kind: string;
    name: string;
  }> = [];
  const requests: string[] = [];
  const refusal = (name: string, guarded: boolean, rawArgs: unknown) => {
    if (!isWorkflowRpcFunction(name)) {
      return Response.json({ error: "function_not_allowed" }, { status: 403 });
    }
    if (!guarded && requiresWorkflowRpcGuard(name, rawArgs)) {
      return Response.json({ error: "guard_required" }, { status: 403 });
    }
    return null;
  };
  const run = async (
    request: WorkflowRpcRequest,
    batch?: number
  ): Promise<unknown> => {
    const args = jsonToConvex(request.args as never) as Record<string, unknown>;
    calls.push({
      args,
      ...(batch === undefined ? {} : { batch }),
      ...(request.guard ? { guard: request.guard } : {}),
      kind: request.kind,
      name: request.name,
    });
    const handler = handlers[request.name];
    if (!handler) {
      throw new Error(`fake convex: no handler for ${request.name}`);
    }
    return await handler(args, request);
  };
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as
      | WorkflowRpcBatchRequest
      | WorkflowRpcRequest;
    if (body.kind === "batch") {
      if (options.batches === false) {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      for (const op of body.ops) {
        const refused = refusal(op.name, Boolean(body.guard), op.args);
        if (refused) {
          return refused;
        }
      }
      requests.push(`batch(${body.ops.map((op) => op.name).join(",")})`);
      const batch = requests.length;
      const values: unknown[] = [];
      for (const [index, op] of body.ops.entries()) {
        try {
          values.push(
            await run(
              {
                ...op,
                ...(body.guard && op.kind === "mutation"
                  ? { guard: body.guard }
                  : {}),
              },
              batch
            )
          );
        } catch (error) {
          return Response.json(errorBody(error, index));
        }
      }
      return Response.json({
        ok: true,
        value: values.map((value) => convexToJson((value ?? null) as Value)),
      });
    }
    const refused = refusal(body.name, Boolean(body.guard), body.args);
    if (refused) {
      return refused;
    }
    requests.push(body.name);
    try {
      const value = await run(body);
      return Response.json({
        ok: true,
        value: convexToJson((value ?? null) as Value),
      });
    } catch (error) {
      return Response.json(errorBody(error));
    }
  }) as typeof fetch;
  return {
    calls,
    callsTo: (name: string) => calls.filter((call) => call.name === name),
    fetcher,
    requests,
  };
};
