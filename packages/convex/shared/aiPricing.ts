import {
  CLEF_FLASH_MODEL_ID,
  CLEF_INPUT_USD_PER_MILLION,
  CLEF_MODEL_ID,
} from "@teak/files-protocol";

const ONE_MILLION = 1_000_000;

export const WORKERS_AI_PRICING_USD_PER_MILLION = {
  // Clef decision models bill input tokens only (images count as input).
  [CLEF_MODEL_ID]: {
    input: CLEF_INPUT_USD_PER_MILLION[CLEF_MODEL_ID] ?? 0,
    output: 0,
  },
  [CLEF_FLASH_MODEL_ID]: {
    input: CLEF_INPUT_USD_PER_MILLION[CLEF_FLASH_MODEL_ID] ?? 0,
    output: 0,
  },
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
