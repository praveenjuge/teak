import { NonRetryableError } from "cloudflare:workflows";
import {
  buildWorkflowRpcSigningPayload,
  normalizeConvexSiteUrl,
  parseConvexSiteUrls,
  WORKFLOW_RPC_HEADERS,
  WORKFLOW_RPC_PATH,
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
import { hmacSha256Hex, sha256Hex } from "./lib";

/**
 * Workflow steps and queue consumers read and write Convex through its
 * signed workflow RPC gateway (`packages/convex/workflowGateway.ts`), one
 * allowlisted internal function per call.
 */

export interface ConvexRpcEnv {
  /**
   * The Convex deployments (HTTP actions origins, `*.convex.site`) this
   * Worker serves, comma-separated. The first is the primary one.
   */
  CONVEX_SITE_URLS?: string;
  FILES_SIGNING_SECRET: string;
}

/** The deployments this Worker serves. */
export const convexSiteUrls = (env: ConvexRpcEnv): string[] =>
  parseConvexSiteUrls(env.CONVEX_SITE_URLS);

/** The origin when this Worker serves it, else null. */
export const allowedConvexSiteUrl = (
  env: ConvexRpcEnv,
  value: unknown
): string | null => {
  const origin = normalizeConvexSiteUrl(value);
  return origin && convexSiteUrls(env).includes(origin) ? origin : null;
};

/** Signed RPCs stay valid this long; the gateway allows at most 5 minutes. */
const RPC_TTL_SECONDS = 120;
const RPC_TIMEOUT_MS = 60_000;

/** The gateway refused a write for a card this run no longer owns. */
const NON_RETRYABLE_CODES = new Set([
  "card_missing",
  "stale_processing_revision",
]);

/** A Convex function threw; `code` is its ConvexError code, when it had one. */
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

/** An RPC client for one of the deployments this Worker serves. */
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
    if (!(origin && env.FILES_SIGNING_SECRET)) {
      throw new NonRetryableError("convex_rpc_not_configured");
    }
    const body = JSON.stringify({
      args: convexToJson((args ?? {}) as Value),
      kind,
      name,
      ...(guard ? { guard } : {}),
    });
    const requestId = crypto.randomUUID();
    const expiresAt = String(Math.floor(Date.now() / 1000) + RPC_TTL_SECONDS);
    const signature = await hmacSha256Hex(
      env.FILES_SIGNING_SECRET,
      buildWorkflowRpcSigningPayload({
        bodySha256: await sha256Hex(body),
        expiresAt,
        requestId,
      })
    );
    let response: Response;
    try {
      response = await fetcher(`${origin}${WORKFLOW_RPC_PATH}`, {
        body,
        headers: {
          "content-type": "application/json",
          [WORKFLOW_RPC_HEADERS.expiresAt]: expiresAt,
          [WORKFLOW_RPC_HEADERS.requestId]: requestId,
          [WORKFLOW_RPC_HEADERS.signature]: signature,
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `convex_rpc_unavailable:${name}:${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      // A wrong secret or a function missing from the allowlist won't fix
      // itself on retry.
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
    if (code && NON_RETRYABLE_CODES.has(code)) {
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
