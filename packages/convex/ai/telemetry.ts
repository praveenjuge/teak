"use node";

import { distribution, trackAiCall } from "../shared/metrics";
import {
  normalizeErrorClass,
  TELEMETRY_METRICS,
  type TelemetryStage,
} from "../shared/telemetry";
import { recordBackendAiContent, withBackendSpan } from "../telemetry/sentry";

const ONE_MILLION = 1_000_000;

const GROQ_PRICING_USD_PER_MILLION = {
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
  "openai/gpt-oss-20b": { input: 0.075, output: 0.3 },
  "qwen/qwen3.6-27b": { input: 0.6, output: 3 },
} as const;

export type PricedGroqModel = keyof typeof GROQ_PRICING_USD_PER_MILLION;

export const createAiTelemetrySettings = (input: {
  functionId: string;
  model: string;
  stage: TelemetryStage;
}) => ({
  functionId: input.functionId,
  isEnabled: true,
  metadata: {
    "teak.model": input.model,
    "teak.provider": "groq",
    "teak.stage": input.stage,
  },
  // Content is recorded explicitly through Teak's scrubbed/truncated span path.
  recordInputs: false,
  recordOutputs: false,
});

export const estimateGroqCostUsd = (input: {
  cachedInputTokens?: number;
  inputTokens?: number;
  model: string;
  outputTokens?: number;
}): number | undefined => {
  const prices = GROQ_PRICING_USD_PER_MILLION[input.model as PricedGroqModel];
  if (!prices) {
    return;
  }
  const inputTokens = input.inputTokens ?? 0;
  const cachedInputTokens = Math.min(
    inputTokens,
    Math.max(0, input.cachedInputTokens ?? 0)
  );
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const inputCost =
    (uncachedInputTokens * prices.input +
      cachedInputTokens * prices.input * 0.5) /
    ONE_MILLION;
  const outputCost = ((input.outputTokens ?? 0) * prices.output) / ONE_MILLION;
  return inputCost + outputCost;
};

interface AiUsage {
  inputTokenDetails?: { cacheReadTokens?: number };
  inputTokens?: number;
  outputTokens?: number;
}

const getUsage = (result: unknown): AiUsage | undefined => {
  if (!(result && typeof result === "object" && "usage" in result)) {
    return;
  }
  return (result as { usage?: AiUsage }).usage;
};

export const observeAiGeneration = async <T>(
  input: {
    functionId: string;
    model: string;
    prompt?: string;
    stage?: TelemetryStage;
    system?: string;
  },
  generate: () => Promise<T>
): Promise<T> => {
  const run = async (): Promise<T> => {
    const startedAt = Date.now();
    recordBackendAiContent({ prompt: input.prompt, system: input.system });
    try {
      const result = await generate();
      const usage = getUsage(result);
      const costUsd = estimateGroqCostUsd({
        cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens,
        inputTokens: usage?.inputTokens,
        model: input.model,
        outputTokens: usage?.outputTokens,
      });
      recordBackendAiContent({ response: getResponseText(result) });
      trackAiCall({
        durationMs: Date.now() - startedAt,
        inputTokens: usage?.inputTokens,
        model: input.model,
        outcome: "success",
        outputTokens: usage?.outputTokens,
        provider: "groq",
      });
      if (costUsd !== undefined) {
        distribution(
          TELEMETRY_METRICS.aiCostUsd,
          costUsd,
          { function: input.functionId, model: input.model, provider: "groq" },
          "none"
        );
      }
      return result;
    } catch (error) {
      trackAiCall({
        durationMs: Date.now() - startedAt,
        model: input.model,
        outcome: "failure",
        provider: "groq",
        validationFailure: normalizeErrorClass(error) === "ValidationError",
      });
      throw error;
    }
  };

  if (!(input.prompt || input.system)) {
    return await run();
  }

  return await withBackendSpan(
    {
      attributes: { model: input.model, provider: "groq" },
      name: input.functionId,
      operation: "gen_ai.generate",
      stage: input.stage ?? "ai_metadata",
      surface: "backend",
    },
    run
  );
};

const getResponseText = (result: unknown): string | undefined => {
  if (!(result && typeof result === "object")) {
    return;
  }
  if ("text" in result && typeof result.text === "string") {
    return result.text;
  }
  if (!("output" in result)) {
    return;
  }
  try {
    return JSON.stringify(result.output);
  } catch {
    // Content telemetry must never alter the generation result.
    return;
  }
};
