import { AsyncLocalStorage } from "node:async_hooks";
import { estimateWorkersAiCostUsd } from "@teak/convex/shared/aiPricing";

/**
 * Whose Workers AI call this is. Workflow steps and queue consumers run the
 * AI ops for one card at a time inside `runWithAiUsage`, so each call can be
 * charged to its owner in Workers Analytics Engine without threading the
 * owner through every op. The store is per async context, so concurrent
 * steps in one isolate never mix up owners.
 */
export interface AiUsageContext {
  cardId?: string;
  /** The deployment the card belongs to; one dataset serves several. */
  convexSiteUrl: string;
  userId: string;
}

const storage = new AsyncLocalStorage<AiUsageContext>();

export const runWithAiUsage = <T>(
  context: AiUsageContext,
  callback: () => Promise<T>
): Promise<T> => storage.run(context, callback);

export const currentAiUsageContext = (): AiUsageContext | undefined =>
  storage.getStore();

export interface AiUsageEnv {
  AI?: unknown;
  /** Workers Analytics Engine dataset for AI usage (`teak_ai_usage`). */
  AI_USAGE?: AnalyticsEngineDataset;
}

export type AiCallOutcome = "capacity" | "error" | "ok";

interface AiCallFacts {
  functionId: string;
  inputTokens: number;
  latencyMs: number;
  model: string;
  outcome: AiCallOutcome;
  outputTokens: number;
}

const tokenCount = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;

/** Token counts from a Workers AI reply (`usage`, OpenAI style). */
export const readAiTokenUsage = (
  response: unknown
): { inputTokens: number; outputTokens: number } => {
  const usage =
    response && typeof response === "object" && "usage" in response
      ? (response as { usage?: Record<string, unknown> | null }).usage
      : undefined;
  return {
    inputTokens: tokenCount(usage?.prompt_tokens),
    outputTokens: tokenCount(usage?.completion_tokens),
  };
};

/**
 * One Analytics Engine data point per Workers AI call, charged to the card
 * owner in the current `runWithAiUsage` context. Calls outside one (the
 * public API's search, Convex's own op calls) are not charged to anyone.
 * Layout, read back by the hourly rollup (aiUsageRollup.ts):
 * indexes [userId]; blobs [convexSiteUrl, model, functionId, outcome];
 * doubles [calls, errors, inputTokens, outputTokens, costUsd, latencyMs].
 */
export const recordAiCall = (env: AiUsageEnv, facts: AiCallFacts): void => {
  const context = currentAiUsageContext();
  const dataset = env.AI_USAGE;
  if (!(context && dataset)) {
    return;
  }
  try {
    dataset.writeDataPoint({
      blobs: [
        context.convexSiteUrl,
        facts.model,
        facts.functionId,
        facts.outcome,
      ],
      doubles: [
        1,
        facts.outcome === "ok" ? 0 : 1,
        facts.inputTokens,
        facts.outputTokens,
        estimateWorkersAiCostUsd({
          inputTokens: facts.inputTokens,
          model: facts.model,
          outputTokens: facts.outputTokens,
        }) ?? 0,
        facts.latencyMs,
      ],
      indexes: [context.userId],
    });
  } catch (error) {
    console.error("[ai-usage] data point not written", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Runs one Workers AI call and records it. `isCapacity` tells a capacity
 * refusal from other failures; the call's own result or error is returned
 * or rethrown unchanged.
 */
export const meteredAiRun = async <T>(
  env: AiUsageEnv,
  call: {
    functionId: string;
    isCapacity?: (error: unknown) => boolean;
    model: string;
  },
  run: () => Promise<T>
): Promise<T> => {
  const startedAt = Date.now();
  try {
    const response = await run();
    recordAiCall(env, {
      functionId: call.functionId,
      latencyMs: Date.now() - startedAt,
      model: call.model,
      outcome: "ok",
      ...readAiTokenUsage(response),
    });
    return response;
  } catch (error) {
    recordAiCall(env, {
      functionId: call.functionId,
      inputTokens: 0,
      latencyMs: Date.now() - startedAt,
      model: call.model,
      outcome: call.isCapacity?.(error) ? "capacity" : "error",
      outputTokens: 0,
    });
    throw error;
  }
};
