import {
  normalizeConvexSiteUrl,
  parseWorkflowRpcBatchRequest,
  parseWorkflowRpcRequest,
  verifyWorkflowRpcRequest,
  WORKFLOW_RPC_MAX_BODY_BYTES,
  type WorkflowRpcBatchOp,
  type WorkflowRpcBatchRequest,
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
  internalQuery,
  type MutationCtx,
  type QueryCtx,
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

const checkGuard = async (
  ctx: QueryCtx,
  { cardId, rev }: { cardId: string; rev: number }
): Promise<void> => {
  const id = ctx.db.normalizeId("cards", cardId);
  const card = id ? await ctx.db.get("cards", id) : null;
  if (!card) {
    refuse("card_missing");
  }
  if ((card?.processingRev ?? 0) !== rev) {
    refuse("stale_processing_revision");
  }
};

interface FailedBatchOp {
  batchIndex: number;
  code?: string;
  data?: Value;
  message: string;
}

const isFailedBatchOp = (data: unknown): data is FailedBatchOp =>
  Boolean(data) &&
  typeof data === "object" &&
  typeof (data as { batchIndex?: unknown }).batchIndex === "number";

// An error crosses `runMutation` only as a ConvexError's data, so a failed
// op's code, data and message travel there with its index.
const failedOp = (error: unknown, batchIndex: number): ConvexError<Value> => {
  const described = describeError(error);
  return new ConvexError({
    batchIndex,
    message: described.message,
    ...(described.code ? { code: described.code } : {}),
    ...(described.data === undefined ? {} : { data: described.data as Value }),
  } as Value);
};

const runOps = async (
  ctx: Pick<MutationCtx, "runMutation" | "runQuery">,
  ops: WorkflowRpcBatchOp[]
): Promise<unknown[]> => {
  const values: unknown[] = [];
  for (const [index, op] of ops.entries()) {
    const args = jsonToConvex(op.args as never) as Record<string, Value>;
    try {
      values.push(
        (op.kind === "query"
          ? await ctx.runQuery(makeFunctionReference<"query">(op.name), args)
          : await ctx.runMutation(
              makeFunctionReference<"mutation">(op.name),
              args
            )) ?? null
      );
    } catch (error) {
      throw failedOp(error, index);
    }
  }
  return values;
};

/**
 * A batch with a write or a guard: one transaction, the guard checked once
 * before the first op, so a stale run applies none of it.
 */
export const runBatch = internalMutation({
  args: {
    guard: v.optional(v.object({ cardId: v.string(), rev: v.number() })),
    ops: v.array(v.any()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, { guard, ops }) => {
    if (guard) {
      await checkGuard(ctx, guard);
    }
    return await runOps(ctx, ops as WorkflowRpcBatchOp[]);
  },
});

/** A batch of reads only, as one query: the reads see one snapshot. */
export const runQueryBatch = internalQuery({
  args: { ops: v.array(v.any()) },
  returns: v.array(v.any()),
  handler: async (ctx, { ops }) => {
    const values: unknown[] = [];
    for (const [index, op] of (ops as WorkflowRpcBatchOp[]).entries()) {
      try {
        values.push(
          (await ctx.runQuery(
            makeFunctionReference<"query">(op.name),
            jsonToConvex(op.args as never) as Record<string, Value>
          )) ?? null
        );
      } catch (error) {
        throw failedOp(error, index);
      }
    }
    return values;
  },
});

export const runGuarded = internalMutation({
  args: {
    args: v.any(),
    cardId: v.string(),
    name: v.string(),
    rev: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, { args, cardId, name, rev }) => {
    await checkGuard(ctx, { cardId, rev });
    return await ctx.runMutation(makeFunctionReference<"mutation">(name), args);
  },
});

function describeError(error: unknown): {
  code?: string;
  data?: unknown;
  index?: number;
  message: string;
} {
  if (error instanceof ConvexError) {
    const data = error.data as unknown;
    if (isFailedBatchOp(data)) {
      return {
        ...(data.code ? { code: data.code } : {}),
        ...(data.data === undefined ? {} : { data: data.data }),
        index: data.batchIndex,
        message: data.message,
      };
    }
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
}

export const runWorkflowRpcBatch = async (
  ctx: Pick<ActionCtx, "runMutation" | "runQuery">,
  batch: WorkflowRpcBatchRequest
): Promise<WorkflowRpcResponse> => {
  try {
    const writes =
      batch.guard || batch.ops.some((op) => op.kind === "mutation");
    const values = writes
      ? await ctx.runMutation(internal.workflowGateway.runBatch, {
          ops: batch.ops,
          ...(batch.guard ? { guard: batch.guard } : {}),
        })
      : await ctx.runQuery(internal.workflowGateway.runQueryBatch, {
          ops: batch.ops,
        });
    return {
      ok: true,
      value: (values as unknown[]).map((value) =>
        convexToJson((value ?? null) as Value)
      ),
    };
  } catch (error) {
    return { error: describeError(error), ok: false };
  }
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
  const batch = parseWorkflowRpcBatchRequest(parsed);
  if (batch) {
    for (const op of batch.ops) {
      if (!isWorkflowRpcFunction(op.name)) {
        return json(403, { error: "function_not_allowed" });
      }
      if (!batch.guard && requiresWorkflowRpcGuard(op.name, op.args)) {
        return json(403, { error: "guard_required" });
      }
    }
    return json(200, await runWorkflowRpcBatch(ctx, batch));
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
