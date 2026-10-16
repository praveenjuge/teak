import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Whose Workers AI call this is. Workflow steps and queue consumers run the
 * AI ops for one card at a time inside `runWithAiUsage`, so each call can be
 * charged to its owner in Workers Analytics Engine without threading the
 * owner through every op. The store is per async context, so concurrent
 * steps in one isolate never mix up owners.
 */
export interface AiUsageContext {
  cardId?: string;
  userId: string;
}

const storage = new AsyncLocalStorage<AiUsageContext>();

export const runWithAiUsage = <T>(
  context: AiUsageContext,
  callback: () => Promise<T>
): Promise<T> => storage.run(context, callback);

export const currentAiUsageContext = (): AiUsageContext | undefined =>
  storage.getStore();
