import {
  normalizeConvexSiteUrl,
  parseWorkflowRpcRequest,
  verifyWorkflowRpcRequest,
  WORKFLOW_RPC_MAX_BODY_BYTES,
  type WorkflowRpcErrorCode,
  type WorkflowRpcRequest,
  type WorkflowRpcResponse,
} from "@teak/files-protocol";
import { makeFunctionReference } from "convex/server";
import {
  ConvexError,
  convexToJson,
  jsonToConvex,
  type Value,
  v,
} from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  env,
  httpAction,
  internalMutation,
} from "./_generated/server";
import {
  isWorkflowRpcFunction,
  requiresWorkflowRpcGuard,
} from "./workflows/rpcAllowlist";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const refuse = (code: WorkflowRpcErrorCode): never => {
  throw new ConvexError({ code });
};

export const runGuarded = internalMutation({
  args: {
    args: v.any(),
    cardId: v.string(),
    name: v.string(),
    rev: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, { args, cardId, name, rev }) => {
    const id = ctx.db.normalizeId("cards", cardId);
    const card = id ? await ctx.db.get("cards", id) : null;
    if (!card) {
      return refuse("card_missing");
    }
    if ((card.processingRev ?? 0) !== rev) {
      return refuse("stale_processing_revision");
    }
    return await ctx.runMutation(makeFunctionReference<"mutation">(name), args);
  },
});

const describeError = (
  error: unknown
): { code?: string; data?: unknown; message: string } => {
  if (error instanceof ConvexError) {
    const data = error.data as unknown;
    let code: string | undefined;
    if (data && typeof data === "object" && "code" in data) {
      code = String((data as { code: unknown }).code);
    } else if (typeof data === "string") {
      code = data;
    }
    return {
      ...(code ? { code } : {}),
      data: convexToJson(data as Value),
      message: error.message,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
  };
};

export const runWorkflowRpc = async (
  ctx: Pick<ActionCtx, "runAction" | "runMutation" | "runQuery">,
  request: WorkflowRpcRequest
): Promise<WorkflowRpcResponse> => {
  const args = jsonToConvex(request.args as never) as Record<string, Value>;
  try {
    let value: unknown;
    if (request.guard) {
      value = await ctx.runMutation(internal.workflowGateway.runGuarded, {
        args,
        cardId: request.guard.cardId,
        name: request.name,
        rev: request.guard.rev,
      });
    } else if (request.kind === "query") {
      value = await ctx.runQuery(
        makeFunctionReference<"query">(request.name),
        args
      );
    } else if (request.kind === "mutation") {
      value = await ctx.runMutation(
        makeFunctionReference<"mutation">(request.name),
        args
      );
    } else {
      value = await ctx.runAction(
        makeFunctionReference<"action">(request.name),
        args
      );
    }
    return { ok: true, value: convexToJson((value ?? null) as Value) };
  } catch (error) {
    return { error: describeError(error), ok: false };
  }
};

export const workflowRpcV1 = httpAction(async (ctx, request) => {
  const secret = env.WORKFLOW_RPC_SECRET;
  const convexSiteUrl = normalizeConvexSiteUrl(env.CONVEX_SITE_URL);
  if (!(secret && convexSiteUrl)) {
    return json(503, { error: "not_configured" });
  }
  const declared = Number(request.headers.get("content-length"));
  if (declared > WORKFLOW_RPC_MAX_BODY_BYTES) {
    return json(413, { error: "too_large" });
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > WORKFLOW_RPC_MAX_BODY_BYTES) {
    return json(413, { error: "too_large" });
  }
  if (
    !(await verifyWorkflowRpcRequest(
      secret,
      convexSiteUrl,
      request.headers,
      body
    ))
  ) {
    return json(401, { error: "unauthorized" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    parsed = null;
  }
  const rpc = parseWorkflowRpcRequest(parsed);
  if (!rpc) {
    return json(400, { error: "invalid_request" });
  }
  if (!isWorkflowRpcFunction(rpc.name)) {
    return json(403, { error: "function_not_allowed" });
  }
  if (!rpc.guard && requiresWorkflowRpcGuard(rpc.name, rpc.args)) {
    return json(403, { error: "guard_required" });
  }
  return json(200, await runWorkflowRpc(ctx, rpc));
});
