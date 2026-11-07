import { NonRetryableError } from "cloudflare:workflows";
import {
  buildWorkflowRpcSecretPayload,
  hmacSha256Hex,
  isWorkflowRpcErrorCode,
  normalizeConvexSiteUrl,
  parseConvexSiteUrls,
  signWorkflowRpcRequest,
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
  constructor(message: string, code?: string, data?: unknown) {
    super(message);
    this.name = "ConvexRpcError";
    this.code = code;
    this.data = data;
  }
}

type AnyReference<Kind extends "action" | "mutation" | "query"> =
  FunctionReference<Kind, "internal" | "public">;

export interface ConvexRpc {
  action: <Ref extends AnyReference<"action">>(
    ref: Ref,
    args: FunctionArgs<Ref>
  ) => Promise<FunctionReturnType<Ref>>;
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
  const call = async (
    kind: WorkflowRpcKind,
    name: string,
    args: unknown,
    guard?: WorkflowRpcGuard
  ): Promise<unknown> => {
    const origin = allowedConvexSiteUrl(env, convexSiteUrl);
    const secret = origin ? await workflowRpcSecret(env, origin) : null;
    if (!(origin && secret)) {
      throw new NonRetryableError("convex_rpc_not_configured");
    }
    const body = JSON.stringify({
      args: convexToJson((args ?? {}) as Value),
      kind,
      name,
      ...(guard ? { guard } : {}),
    });
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
        signal: AbortSignal.timeout(
          kind === "action" ? ACTION_RPC_TIMEOUT_MS : RPC_TIMEOUT_MS
        ),
      });
    } catch (error) {
      throw new Error(
        `convex_rpc_unavailable:${name}:${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      throw new NonRetryableError(
        `convex_rpc_refused:${name}:${String(response.status)}`
      );
    }
    const envelope = (await response
      .json()
      .catch(() => null)) as WorkflowRpcResponse | null;
    if (!(response.ok && envelope)) {
      throw new Error(
        `convex_rpc_unavailable:${name}:${String(response.status)}`
      );
    }
    if (envelope.ok) {
      return jsonToConvex(envelope.value as never);
    }
    const { code, data, message } = envelope.error;
    // The guarded write refused: the card is gone or newer work replaced
    // the run, so another try can't land.
    if (isWorkflowRpcErrorCode(code)) {
      throw new NonRetryableError(`${code}:${name}`);
    }
    throw new ConvexRpcError(message, code, data);
  };
  return {
    action: (ref, args) => call("action", getFunctionName(ref), args) as never,
    mutation: (ref, args, options) =>
      call("mutation", getFunctionName(ref), args, options?.guard) as never,
    query: (ref, args) => call("query", getFunctionName(ref), args) as never,
  };
};
