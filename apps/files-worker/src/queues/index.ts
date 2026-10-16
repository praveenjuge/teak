import type { BackgroundEnv } from "../workflows/runtime";

/** The queue a batch came from, without its `teak-` / `teak-dev-` prefix. */
export const queueRole = (queue: string): string =>
  queue.replace(/^teak-(?:dev-)?/u, "");

/**
 * Routes each consumer batch (wrangler.jsonc `queues.consumers`) to its
 * handler. Unknown queues are acknowledged and logged, so a stray binding
 * cannot retry forever.
 */
export const handleQueueBatch = (
  batch: MessageBatch<unknown>,
  _env: BackgroundEnv,
  _ctx: ExecutionContext
): Promise<void> => {
  switch (queueRole(batch.queue)) {
    default:
      console.error("[queues] no consumer", { queue: batch.queue });
      batch.ackAll();
      return Promise.resolve();
  }
};
