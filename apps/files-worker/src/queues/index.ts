import type { BackgroundEnv } from "../workflows/runtime";
import { type AiBackfillMessage, handleAiBackfillBatch } from "./aiBackfill";
import {
  handleObjectDeletionBatch,
  handleObjectDeletionDeadLetters,
} from "./objectDeletions";
import { handleR2EventsBatch } from "./r2Events";
import {
  handleWorkosEventsBatch,
  handleWorkosEventsDeadLetters,
} from "./workosEvents";

/** The queue a batch came from, without its `teak-`, `teak-dev-` or `teak-e2e-` prefix. */
export const queueRole = (queue: string): string =>
  queue.replace(/^teak-(?:dev-|e2e-)?/u, "");

/**
 * Routes each consumer batch (wrangler.jsonc `queues.consumers`) to its
 * handler. Unknown queues are acknowledged and logged, so a stray binding
 * cannot retry forever.
 */
export const handleQueueBatch = (
  batch: MessageBatch<unknown>,
  env: BackgroundEnv,
  ctx: ExecutionContext
): Promise<void> => {
  switch (queueRole(batch.queue)) {
    case "object-deletions":
      return handleObjectDeletionBatch(batch, env);
    case "object-deletions-dlq":
      return handleObjectDeletionDeadLetters(batch, env, ctx);
    case "workos-events":
      return handleWorkosEventsBatch(batch, env);
    case "workos-events-dlq":
      return handleWorkosEventsDeadLetters(batch, env);
    case "r2-events":
      return handleR2EventsBatch(batch, env);
    case "ai-backfill":
      return handleAiBackfillBatch(
        batch as MessageBatch<AiBackfillMessage>,
        env
      );
    default:
      console.error("[queues] no consumer", { queue: batch.queue });
      batch.ackAll();
      return Promise.resolve();
  }
};
