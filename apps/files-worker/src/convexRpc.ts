import { NonRetryableError } from "cloudflare:workflows";
import {
  buildWorkflowRpcSecretPayload,
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
  /**
   * Root of every deployment's workflow RPC secret. Only the Worker holds it;
   * each deployment holds its own derived secret (`workflowRpcSecret`).
   */
  WORKFLOW_RPC_ROOT_SECRET?: string;
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

/**
 * The secret one deployment signs and verifies workflow RPCs and dispatch
 * proofs with. Deriving it per origin means the development deployment's
 * secret never works for production.
 */
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

/** Signed RPCs stay valid this long; the gateway allows at most 5 minutes. */
const RPC_TTL_SECONDS = 120;
const RPC_TIMEOUT_MS = 60_000;
/**
 * Convex lets an action run for 10 minutes; a long one (the vector ledger
 * sweep) must not be abandoned and retried while it is still going.
 */
const ACTION_RPC_TIMEOUT_MS = 10 * 60_000 + 30_000;

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
    const requestId = crypto.randomUUID();
    const expiresAt = String(Math.floor(Date.now() / 1000) + RPC_TTL_SECONDS);
    const signature = await hmacSha256Hex(
      secret,
      buildWorkflowRpcSigningPayload({
        bodySha256: await sha256Hex(body),
        convexSiteUrl: origin,
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
