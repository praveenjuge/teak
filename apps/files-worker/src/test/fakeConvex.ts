import {
  isWorkflowRpcFunction,
  requiresWorkflowRpcGuard,
} from "@teak/convex/workflows/rpcAllowlist";
import type { WorkflowRpcRequest } from "@teak/files-protocol";
import { convexToJson, jsonToConvex, type Value } from "convex/values";

export const TEST_CONVEX_SITE_URL = "https://test-deployment.convex.site";
export const TEST_SIGNING_SECRET = "test-files-signing-secret";
export const TEST_RPC_ROOT_SECRET = "test-workflow-rpc-root-secret";

export const fakeConvexEnv = {
  CONVEX_SITE_URLS: TEST_CONVEX_SITE_URL,
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
    if (
      !request.guard &&
      requiresWorkflowRpcGuard(request.name, request.args)
    ) {
      return Response.json({ error: "guard_required" }, { status: 403 });
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
    callsTo: (name: string) => calls.filter((call) => call.name === name),
    fetcher,
  };
};
