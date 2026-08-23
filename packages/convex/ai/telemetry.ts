"use node";

import { distribution, trackAiCall } from "../shared/metrics";
import {
  normalizeErrorClass,
  TELEMETRY_METRICS,
  type TelemetryStage,
} from "../shared/telemetry";
import { recordBackendAiContent, withBackendSpan } from "../telemetry/sentry";

const ONE_MILLION = 1_000_000;

export const WORKERS_AI_PROVIDER = "cloudflare";

const WORKERS_AI_PRICING_USD_PER_MILLION = {
  "@cf/google/gemma-4-26b-a4b-it": { input: 0.1, output: 0.3 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { input: 0.051, output: 0.335 },
} as const;

export type PricedWorkersAiModel =
  keyof typeof WORKERS_AI_PRICING_USD_PER_MILLION;

export const createAiTelemetrySettings = (input: {
  functionId: string;
  model: string;
  stage: TelemetryStage;
}) => ({
  functionId: input.functionId,
  isEnabled: true,
  metadata: {
    "teak.model": input.model,
    "teak.provider": WORKERS_AI_PROVIDER,
    "teak.stage": input.stage,
  },
  // Content is recorded explicitly through Teak's scrubbed/truncated span path.
  recordInputs: false,
  recordOutputs: false,
});

export const estimateWorkersAiCostUsd = (input: {
  inputTokens?: number;
  model: string;
  outputTokens?: number;
}): number | undefined => {
  const prices =
    WORKERS_AI_PRICING_USD_PER_MILLION[input.model as PricedWorkersAiModel];
  if (!prices) {
    return;
  }
  const inputCost = ((input.inputTokens ?? 0) * prices.input) / ONE_MILLION;
  const outputCost = ((input.outputTokens ?? 0) * prices.output) / ONE_MILLION;
  return inputCost + outputCost;
};

interface AiUsage {
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
      const costUsd = estimateWorkersAiCostUsd({
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
        provider: WORKERS_AI_PROVIDER,
      });
      if (costUsd !== undefined) {
        distribution(
          TELEMETRY_METRICS.aiCostUsd,
          costUsd,
          {
            function: input.functionId,
            model: input.model,
            provider: WORKERS_AI_PROVIDER,
          },
          "none"
        );
      }
      return result;
    } catch (error) {
      trackAiCall({
        durationMs: Date.now() - startedAt,
        model: input.model,
        outcome: "failure",
        provider: WORKERS_AI_PROVIDER,
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
      attributes: { model: input.model, provider: WORKERS_AI_PROVIDER },
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
  }
};
