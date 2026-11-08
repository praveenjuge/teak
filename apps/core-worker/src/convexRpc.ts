import { NonRetryableError } from "cloudflare:workflows";
import {
  buildWorkflowRpcSecretPayload,
  hmacSha256Hex,
  isWorkflowRpcErrorCode,
  normalizeConvexSiteUrl,
  parseConvexSiteUrls,
  signWorkflowRpcRequest,
  WORKFLOW_RPC_MAX_BATCH_OPS,
  type WorkflowRpcGuard,
  type WorkflowRpcKind,
  type WorkflowRpcResponse,
} from "@teak/files-protocol";
import {
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  getFunctionName,
} from "convex/server";
import { convexToJson, jsonToConvex, type Value } from "convex/values";

export interface ConvexRpcEnv {
  CONVEX_SITE_URLS?: string;
  WORKFLOW_RPC_ROOT_SECRET?: string;
}

export const convexSiteUrls = (env: ConvexRpcEnv): string[] =>
  parseConvexSiteUrls(env.CONVEX_SITE_URLS);

export const allowedConvexSiteUrl = (
  env: ConvexRpcEnv,
  value: unknown
): string | null => {
  const origin = normalizeConvexSiteUrl(value);
  return origin && convexSiteUrls(env).includes(origin) ? origin : null;
};

export const workflowRpcSecret = async (
  env: ConvexRpcEnv,
  convexSiteUrl: string
): Promise<string | null> =>
  env.WORKFLOW_RPC_ROOT_SECRET
    ? await hmacSha256Hex(
        env.WORKFLOW_RPC_ROOT_SECRET,
        buildWorkflowRpcSecretPayload(convexSiteUrl)
      )
    : null;

const RPC_TIMEOUT_MS = 60_000;
/**
 * Convex lets an action run for 10 minutes; a long one (the vector ledger
 * sweep) must not be abandoned and retried while it is still going.
 */
const ACTION_RPC_TIMEOUT_MS = 10 * 60_000 + 30_000;

export class ConvexRpcError extends Error {
  readonly code: string | undefined;
  readonly data: unknown;
  /** In a batch, the op that failed: `<function>#<index>`. */
  readonly operation: string | undefined;
  constructor(
    message: string,
    code?: string,
    data?: unknown,
    operation?: string
  ) {
    super(message);
    this.name = "ConvexRpcError";
    this.code = code;
    this.data = data;
    this.operation = operation;
  }
}

type AnyReference<Kind extends "action" | "mutation" | "query"> =
  FunctionReference<Kind, "internal" | "public">;

/**
 * One op of `ConvexRpc.batch`, carrying its function's return type. Make
 * them with `batchOp.query` and `batchOp.mutation`.
 */
export interface BatchOp<Result = unknown> {
  readonly args: unknown;
  readonly kind: "mutation" | "query";
  readonly name: string;
  /** Type only: what the op's function returns. */
  readonly result?: Result;
}

export const batchOp = {
  query: <Ref extends AnyReference<"query">>(
    ref: Ref,
    args: FunctionArgs<Ref>
  ): BatchOp<FunctionReturnType<Ref>> => ({
    args,
    kind: "query",
    name: getFunctionName(ref),
  }),
  mutation: <Ref extends AnyReference<"mutation">>(
    ref: Ref,
    args: FunctionArgs<Ref>
  ): BatchOp<FunctionReturnType<Ref>> => ({
    args,
    kind: "mutation",
    name: getFunctionName(ref),
  }),
};

export type BatchResults<Ops extends readonly BatchOp[]> = {
  -readonly [Index in keyof Ops]: Ops[Index] extends BatchOp<infer Result>
    ? Result
    : never;
};

export interface ConvexRpc {
  action: <Ref extends AnyReference<"action">>(
    ref: Ref,
    args: FunctionArgs<Ref>
  ) => Promise<FunctionReturnType<Ref>>;
  /**
   * Runs the ops in order in one call and one Convex transaction, checking
   * the guard once before the first; a failed op refuses the whole batch.
   */
  batch: <const Ops extends readonly BatchOp[]>(
    ops: Ops,
    options?: { guard?: WorkflowRpcGuard }
  ) => Promise<BatchResults<Ops>>;
  mutation: <Ref extends AnyReference<"mutation">>(
    ref: Ref,
    args: FunctionArgs<Ref>,
    options?: { guard?: WorkflowRpcGuard }
  ) => Promise<FunctionReturnType<Ref>>;
  query: <Ref extends AnyReference<"query">>(
    ref: Ref,
    args: FunctionArgs<Ref>
  ) => Promise<FunctionReturnType<Ref>>;
}

export const createConvexRpc = (
  env: ConvexRpcEnv,
  convexSiteUrl: string,
  fetcher: typeof fetch = fetch
): ConvexRpc => {
  const post = async (
    label: string,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<{ kind: "unsupported" } | { kind: "value"; value: unknown }> => {
    const origin = allowedConvexSiteUrl(env, convexSiteUrl);
    const secret = origin ? await workflowRpcSecret(env, origin) : null;
    if (!(origin && secret)) {
      throw new NonRetryableError("convex_rpc_not_configured");
    }
    const body = JSON.stringify(payload);
    const signed = await signWorkflowRpcRequest({
      body,
      convexSiteUrl: origin,
      secret,
    });
    let response: Response;
    try {
      response = await fetcher(signed.url, {
        body,
        headers: signed.headers,
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(
        `convex_rpc_unavailable:${label}:${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      throw new NonRetryableError(
        `convex_rpc_refused:${label}:${String(response.status)}`
      );
    }
    // A Convex deployed before batches existed can't parse one.
    if (response.status === 400 && payload.kind === "batch") {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "unsupported" };
    }
    const envelope = (await response
      .json()
      .catch(() => null)) as WorkflowRpcResponse | null;
    if (!(response.ok && envelope)) {
      throw new Error(
        `convex_rpc_unavailable:${label}:${String(response.status)}`
      );
    }
    if (envelope.ok) {
      return { kind: "value", value: envelope.value };
    }
    const { code, data, index, message } = envelope.error;
    const failed = index === undefined ? label : `${label}#${String(index)}`;
    // The guarded write refused: the card is gone or newer work replaced
    // the run, so another try can't land.
    if (isWorkflowRpcErrorCode(code)) {
      throw new NonRetryableError(`${code}:${failed}`);
    }
    if (index === undefined) {
      throw new ConvexRpcError(message, code, data);
    }
    // Named in the message too: a Workflow step rethrows only the message,
    // and that is what the run's report carries.
    const op = `${(payload.ops as Array<{ name: string }>)[index]?.name ?? label}#${String(index)}`;
    throw new ConvexRpcError(`${message} [batch op ${op}]`, code, data, op);
  };

  const call = async (
    kind: WorkflowRpcKind,
    name: string,
    args: unknown,
    guard?: WorkflowRpcGuard
  ): Promise<unknown> => {
    const answer = await post(
      name,
      {
        args: convexToJson((args ?? {}) as Value),
        kind,
        name,
        ...(guard ? { guard } : {}),
      },
      kind === "action" ? ACTION_RPC_TIMEOUT_MS : RPC_TIMEOUT_MS
    );
    return answer.kind === "value" ? jsonToConvex(answer.value as never) : null;
  };

  // Set once Convex has refused a batch, so later batches go op by op
  // straight away; see `.agents/records/sunset.md`.
  let batchesUnsupported = false;
  const runOneByOne = async (
    ops: readonly BatchOp[],
    guard?: WorkflowRpcGuard
  ): Promise<unknown[]> => {
    const values: unknown[] = [];
    for (const op of ops) {
      values.push(
        await call(
          op.kind,
          op.name,
          op.args,
          op.kind === "mutation" ? guard : undefined
        )
      );
    }
    return values;
  };

  const batch = async (
    ops: readonly BatchOp[],
    guard?: WorkflowRpcGuard
  ): Promise<unknown[]> => {
    // Convex refuses a longer batch, which would look like one from before
    // batches and send the writes one by one, outside one transaction.
    if (ops.length === 0 || ops.length > WORKFLOW_RPC_MAX_BATCH_OPS) {
      throw new NonRetryableError(
        `convex_rpc_batch_size:${String(ops.length)}`
      );
    }
    if (batchesUnsupported) {
      return await runOneByOne(ops, guard);
    }
    const label = `batch(${ops.map((op) => op.name).join(",")})`;
    const answer = await post(
      label,
      {
        kind: "batch",
        ops: ops.map((op) => ({
          args: convexToJson((op.args ?? {}) as Value),
          kind: op.kind,
          name: op.name,
        })),
        ...(guard ? { guard } : {}),
      },
      RPC_TIMEOUT_MS
    );
    if (answer.kind === "unsupported") {
      batchesUnsupported = true;
      return await runOneByOne(ops, guard);
    }
    return (answer.value as unknown[]).map((value) =>
      jsonToConvex(value as never)
    );
  };

  return {
    action: (ref, args) => call("action", getFunctionName(ref), args) as never,
    mutation: (ref, args, options) =>
      call("mutation", getFunctionName(ref), args, options?.guard) as never,
    query: (ref, args) => call("query", getFunctionName(ref), args) as never,
    batch: (ops, options) => batch(ops, options?.guard) as never,
  };
};
