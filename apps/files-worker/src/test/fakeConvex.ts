import { isWorkflowRpcFunction } from "@teak/convex/workflowRpcAllowlist";
import type { WorkflowRpcRequest } from "@teak/files-protocol";
import { convexToJson, jsonToConvex, type Value } from "convex/values";

export const TEST_CONVEX_SITE_URL = "https://test-deployment.convex.site";
export const TEST_SIGNING_SECRET = "test-files-signing-secret";

/** Env for the RPC client pointed at the fake deployment. */
export const fakeConvexEnv = {
  CONVEX_SITE_URLS: TEST_CONVEX_SITE_URL,
  FILES_SIGNING_SECRET: TEST_SIGNING_SECRET,
};

export type FakeHandler = (
  args: Record<string, unknown>,
  request: WorkflowRpcRequest
) => unknown | Promise<unknown>;

/** A Convex function failure, as the gateway reports it. */
export class FakeConvexError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Stands in for the Convex workflow RPC gateway behind `fetch`, so tests run
 * the real signed client. Each call must name an allowlisted function and
 * have a handler; calls are recorded in order.
 */
export const createFakeConvex = (handlers: Record<string, FakeHandler>) => {
  const calls: Array<{
    args: Record<string, unknown>;
    guard?: WorkflowRpcRequest["guard"];
    kind: string;
    name: string;
  }> = [];
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as WorkflowRpcRequest;
    if (!isWorkflowRpcFunction(request.name)) {
      return Response.json({ error: "function_not_allowed" }, { status: 403 });
    }
    const args = jsonToConvex(request.args as never) as Record<string, unknown>;
    calls.push({
      args,
      ...(request.guard ? { guard: request.guard } : {}),
      kind: request.kind,
      name: request.name,
    });
    const handler = handlers[request.name];
    if (!handler) {
      throw new Error(`fake convex: no handler for ${request.name}`);
    }
    try {
      const value = await handler(args, request);
      return Response.json({
        ok: true,
        value: convexToJson((value ?? null) as Value),
      });
    } catch (error) {
      return Response.json({
        error: {
          ...(error instanceof FakeConvexError && error.code
            ? { code: error.code }
            : {}),
          message: error instanceof Error ? error.message : String(error),
        },
        ok: false,
      });
    }
  }) as typeof fetch;
  return {
    calls,
    /** Calls to one function, in order. */
    callsTo: (name: string) => calls.filter((call) => call.name === name),
    fetcher,
  };
};
