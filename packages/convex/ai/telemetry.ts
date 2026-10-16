"use node";

import type { TelemetryStage } from "../shared/telemetry";
import {
  captureBackendEvent,
  currentTelemetryTraceId,
} from "../telemetry/posthog";

const ONE_MILLION = 1_000_000;

export const WORKERS_AI_PROVIDER = "cloudflare";

const WORKERS_AI_PRICING_USD_PER_MILLION = {
  // Clef decision models bill input tokens only (images count as input).
  "@cf/cloudflare/clef": { input: 0.24, output: 0 },
  "@cf/cloudflare/clef-flash": { input: 0.09, output: 0 },
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

export interface AiUsageTotals {
  calls: number;
  costUsd: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
}

let activeUsage: AiUsageTotals | null = null;

/**
 * Runs `callback` and totals every model call made inside it. `onFinish`
 * receives the totals whether the callback succeeds or throws, so AI spend
 * is recorded against the card's owner either way; its own failures are
 * logged and never replace the callback's outcome. Nested calls add to the
 * outer total.
 */
export const collectAiUsage = async <T>(
  callback: () => Promise<T>,
  onFinish: (usage: AiUsageTotals) => Promise<void>
): Promise<T> => {
  if (activeUsage) {
    return await callback();
  }
  const usage: AiUsageTotals = {
    calls: 0,
    costUsd: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  activeUsage = usage;
  try {
    return await callback();
  } finally {
    activeUsage = null;
    try {
      await onFinish(usage);
    } catch (error) {
      console.error("[ai/telemetry] failed to record AI usage", error);
    }
  }
};

const addUsage = (
  model: string,
  usage: AiUsage | undefined,
  isError: boolean
) => {
  if (!activeUsage) {
    return;
  }
  activeUsage.calls += 1;
  activeUsage.errors += isError ? 1 : 0;
  activeUsage.inputTokens += usage?.inputTokens ?? 0;
  activeUsage.outputTokens += usage?.outputTokens ?? 0;
  activeUsage.costUsd +=
    estimateWorkersAiCostUsd({
      inputTokens: usage?.inputTokens,
      model,
      outputTokens: usage?.outputTokens,
    }) ?? 0;
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
  const record = (usage: AiUsage | undefined, error?: unknown) => {
    addUsage(input.model, usage, error !== undefined);
    return captureBackendEvent("$ai_generation", undefined, {
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
  };
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
