import type { BackgroundEnv } from "../workflows/runtime";
import { type AiBackfillMessage, handleAiBackfillBatch } from "./aiBackfill";
import {
  handleObjectDeletionBatch,
  handleObjectDeletionDeadLetters,
} from "./objectDeletions";
import { handleR2EventsBatch } from "./r2Events";

export const queueRole = (queue: string): string =>
  queue.replace(/^teak-(?:e2e-)?/u, "").replace(/-dev$/u, "");

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
