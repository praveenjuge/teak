"use node";

import type { TelemetryStage } from "../shared/telemetry";
import {
  captureBackendEvent,
  currentTelemetryTraceId,
} from "../telemetry/posthog";

const ONE_MILLION = 1_000_000;

export const WORKERS_AI_PROVIDER = "cloudflare";

const WORKERS_AI_PRICING_USD_PER_MILLION = {
  "@cf/google/gemma-4-26b-a4b-it": { input: 0.1, output: 0.3 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { input: 0.051, output: 0.335 },
} as const;

export type PricedWorkersAiModel =
  keyof typeof WORKERS_AI_PRICING_USD_PER_MILLION;

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

/**
 * Sends one `$ai_generation` event per model call: model, tokens, latency,
 * and cost. Prompts and outputs are private and never leave Teak.
 */
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
  const startedAt = Date.now();
  const record = (usage: AiUsage | undefined, error?: unknown) =>
    captureBackendEvent("$ai_generation", undefined, {
      ...(error === undefined
        ? {}
        : { $ai_error: error instanceof Error ? error.name : "Error" }),
      $ai_input_tokens: usage?.inputTokens,
      $ai_is_error: error !== undefined,
      $ai_latency: (Date.now() - startedAt) / 1000,
      $ai_model: input.model,
      $ai_output_tokens: usage?.outputTokens,
      $ai_provider: WORKERS_AI_PROVIDER,
      $ai_span_name: input.functionId,
      $ai_total_cost_usd: estimateWorkersAiCostUsd({
        inputTokens: usage?.inputTokens,
        model: input.model,
        outputTokens: usage?.outputTokens,
      }),
      $ai_trace_id: currentTelemetryTraceId(),
    });
  try {
    const result = await generate();
    await record(getUsage(result));
    return result;
  } catch (error) {
    const usage =
      error && typeof error === "object" && "aiFacts" in error
        ? getUsage((error as { aiFacts?: unknown }).aiFacts)
        : undefined;
    await record(usage, error);
    throw error;
  }
};
