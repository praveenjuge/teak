import { sha256Hex } from "@teak/files-protocol";
import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { IdempotencyOutcome } from "../../idempotencyAnalytics";
import { parseOptionalString } from "../validation";
import { errorResponse, json, mapConvexErrorToResponse } from "./shared";

/**
 * Each idempotent operation's namespace: hashed into every stored request,
 * and the endpoint its analytics are counted under. They are the paths the
 * operations had when keys were first stored, and must never change, or a
 * retry stops matching the request it repeats.
 */
const IDEMPOTENCY_NAMESPACES = {
  bulkCards: "/v1/cards/bulk",
  createCard: "/v1/cards",
} as const;

type IdempotentOperation = keyof typeof IDEMPOTENCY_NAMESPACES;

const buildIdempotentResponse = (record: {
  responseBody: unknown;
  responseStatus: number;
}): Response => json(record.responseStatus, record.responseBody);

interface IdempotencyState {
  keyHash: string;
  leaseToken?: string;
  replayed?: Response;
  requestHash: string;
  reserved: boolean;
}

const trackIdempotency = async (
  ctx: ActionCtx,
  endpoint: string,
  outcome: IdempotencyOutcome,
  requestKey: string
) => {
  await ctx.runMutation(internal.idempotencyAnalytics.trackIdempotencyOutcome, {
    endpoint,
    outcome,
    requestKey,
  });
};

const maybeHandleIdempotency = async (
  ctx: ActionCtx,
  args: {
    userId: string;
    method: "POST";
    path: string;
    requestBody: unknown;
    request: Request;
  }
): Promise<IdempotencyState | Response> => {
  const idempotencyKey = parseOptionalString(
    args.request.headers.get("idempotency-key")
  );
  if (!idempotencyKey) {
    return {
      keyHash: "",
      requestHash: "",
      reserved: false,
    };
  }

  const [keyHash, requestHash] = await Promise.all([
    sha256Hex(`${args.userId}:${idempotencyKey}`),
    sha256Hex(
      JSON.stringify({
        body: args.requestBody,
        method: args.method,
        path: args.path,
      })
    ),
  ]);

  const reservation = await ctx.runMutation(
    internal.idempotency.beginIdempotencyRequestForUser,
    {
      keyHash,
      method: args.method,
      path: args.path,
      requestHash,
      userId: args.userId,
    }
  );

  switch (reservation.status) {
    case "started":
      await trackIdempotency(ctx, args.path, "started", keyHash);
      return {
        keyHash,
        leaseToken: reservation.record.leaseToken,
        requestHash,
        reserved: true,
      };
    case "replay":
      await trackIdempotency(ctx, args.path, "replayed", keyHash);
      return {
        keyHash,
        requestHash,
        reserved: false,
        replayed: buildIdempotentResponse(reservation.record),
      };
    case "in_progress":
      await trackIdempotency(ctx, args.path, "in_progress", keyHash);
      // Not the caller's mistake, unlike a reused key: the first request is
      // still running, and the same request again soon gets its answer.
      return errorResponse(
        409,
        "IN_PROGRESS",
        "Idempotency-Key is already being processed; retry shortly",
        undefined,
        { "Retry-After": "1" }
      );
    case "conflict":
      await trackIdempotency(ctx, args.path, "conflict", keyHash);
      return errorResponse(
        409,
        "CONFLICT",
        "Idempotency-Key was already used with a different request"
      );
    default:
      await trackIdempotency(ctx, args.path, "error", keyHash);
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to reserve Idempotency-Key"
      );
  }
};

// Storing the answer can fail after the write it answers went through. The
// caller still gets its answer, and the scheduler stores it, so a retry with
// the same key replays it instead of waiting out the lease.
const completeIdempotencyResponse = async (
  ctx: ActionCtx,
  args: {
    userId: string;
    keyHash: string;
    leaseToken?: string;
    requestHash: string;
    responseBody: unknown;
    responseStatus: number;
  }
): Promise<void> => {
  if (!args.keyHash) {
    return;
  }

  const completion = {
    keyHash: args.keyHash,
    leaseToken: args.leaseToken,
    requestHash: args.requestHash,
    responseBody: args.responseBody,
    responseStatus: args.responseStatus,
    userId: args.userId,
  };
  const reference = internal.idempotency.completeIdempotencyRequestForUser;
  try {
    await ctx.runMutation(reference, completion);
    return;
  } catch (error) {
    console.error("[idempotency] Completion failed; scheduling it", {
      error,
      keyHash: args.keyHash,
    });
  }

  try {
    await ctx.scheduler.runAfter(0, reference, completion);
  } catch (error) {
    console.error("[idempotency] Could not schedule completion", {
      error,
      keyHash: args.keyHash,
    });
  }
};

const releaseReservationKeepingOriginalError = async (
  ctx: ActionCtx,
  args: {
    userId: string;
    keyHash: string;
    leaseToken?: string;
    requestHash: string;
  }
): Promise<void> => {
  if (!args.keyHash) {
    return;
  }

  try {
    await ctx.runMutation(
      internal.idempotency.releaseIdempotencyRequestForUser,
      args
    );
  } catch (error) {
    console.error("[idempotency] Release failed", {
      error,
      keyHash: args.keyHash,
    });
  }
};

/**
 * Runs a write under the request's `Idempotency-Key`, when it has one: a
 * repeat replays the stored answer, and a failure before the write commits
 * frees the key for a retry. `run` calls `committed` once the write is in.
 */
export const respondIdempotently = async (
  ctx: ActionCtx,
  args: {
    failureMessage: string;
    operation: IdempotentOperation;
    request: Request;
    requestBody: unknown;
    userId: string;
  },
  run: (committed: () => void) => Promise<unknown>
): Promise<Response> => {
  let state: IdempotencyState | null = null;
  let operationCommitted = false;
  try {
    const idempotency = await maybeHandleIdempotency(ctx, {
      method: "POST",
      path: IDEMPOTENCY_NAMESPACES[args.operation],
      request: args.request,
      requestBody: args.requestBody,
      userId: args.userId,
    });
    if (idempotency instanceof Response) {
      return idempotency;
    }
    if (idempotency.replayed) {
      return idempotency.replayed;
    }
    state = idempotency;
    const responseBody = await run(() => {
      operationCommitted = true;
    });
    operationCommitted = true;
    await completeIdempotencyResponse(ctx, {
      keyHash: state.keyHash,
      leaseToken: state.leaseToken,
      requestHash: state.requestHash,
      responseBody,
      responseStatus: 200,
      userId: args.userId,
    });
    return json(200, responseBody);
  } catch (error) {
    if (state?.reserved && !operationCommitted) {
      await releaseReservationKeepingOriginalError(ctx, {
        keyHash: state.keyHash,
        leaseToken: state.leaseToken,
        requestHash: state.requestHash,
        userId: args.userId,
      });
    }
    return mapConvexErrorToResponse(error, args.failureMessage);
  }
};
