import { AsyncLocalStorage } from "node:async_hooks";
import { estimateWorkersAiCostUsd } from "@teak/convex/shared/aiPricing";

export interface AiUsageContext {
  cardId?: string;
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

/**
 * Token counts from a Workers AI reply's `usage`: OpenAI style
 * (`prompt_tokens`), or Clef's (`input_tokens`).
 */
export const readAiTokenUsage = (
  response: unknown
): { inputTokens: number; outputTokens: number } => {
  const usage =
    response && typeof response === "object" && "usage" in response
      ? (response as { usage?: Record<string, unknown> | null }).usage
      : undefined;
  return {
    inputTokens: tokenCount(usage?.prompt_tokens ?? usage?.input_tokens),
    outputTokens: tokenCount(usage?.completion_tokens ?? usage?.output_tokens),
  };
};

export const AI_USAGE_BLOBS = [
  "convexSiteUrl",
  "model",
  "functionId",
  "outcome",
] as const;

export const AI_USAGE_DOUBLES = [
  "calls",
  "errors",
  "inputTokens",
  "outputTokens",
  "costUsd",
  "latencyMs",
] as const;

type AiUsageBlob = (typeof AI_USAGE_BLOBS)[number];
type AiUsageDouble = (typeof AI_USAGE_DOUBLES)[number];

export const aiUsageColumn = (name: AiUsageBlob | AiUsageDouble): string => {
  const blob = AI_USAGE_BLOBS.indexOf(name as AiUsageBlob);
  return blob >= 0
    ? `blob${String(blob + 1)}`
    : `double${String(AI_USAGE_DOUBLES.indexOf(name as AiUsageDouble) + 1)}`;
};

export const recordAiCall = (env: AiUsageEnv, facts: AiCallFacts): void => {
  const context = currentAiUsageContext();
  const dataset = env.AI_USAGE;
  if (!(context && dataset)) {
    return;
  }
  try {
    const blobs: Record<AiUsageBlob, string> = {
      convexSiteUrl: context.convexSiteUrl,
      functionId: facts.functionId,
      model: facts.model,
      outcome: facts.outcome,
    };
    const doubles: Record<AiUsageDouble, number> = {
      calls: 1,
      costUsd:
        estimateWorkersAiCostUsd({
          inputTokens: facts.inputTokens,
          model: facts.model,
          outputTokens: facts.outputTokens,
        }) ?? 0,
      errors: facts.outcome === "ok" ? 0 : 1,
      inputTokens: facts.inputTokens,
      latencyMs: facts.latencyMs,
      outputTokens: facts.outputTokens,
    };
    dataset.writeDataPoint({
      blobs: AI_USAGE_BLOBS.map((name) => blobs[name]),
      doubles: AI_USAGE_DOUBLES.map((name) => doubles[name]),
      indexes: [context.userId],
    });
  } catch (error) {
    console.error("[ai-usage] data point not written", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

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
