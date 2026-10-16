// Workers AI list prices, shared by Convex's AI telemetry and the Files
// Worker's Analytics Engine usage points. Pure: no Convex server imports.

const ONE_MILLION = 1_000_000;

export const WORKERS_AI_PRICING_USD_PER_MILLION = {
  "@cf/google/gemma-4-26b-a4b-it": { input: 0.1, output: 0.3 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { input: 0.051, output: 0.335 },
} as const;

export type PricedWorkersAiModel =
  keyof typeof WORKERS_AI_PRICING_USD_PER_MILLION;

/** The call's list price, or undefined for a model without a token price. */
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
