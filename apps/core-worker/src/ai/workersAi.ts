import type { FilesAiGenerationFacts } from "@teak/files-protocol";
import { OpFailure } from "../opFailure";
import {
  type AiGatewayEnv,
  aiRunOptions,
  type WorkersAiBinding,
} from "./aiGateway";
import { type AiUsageEnv, meteredAiRun } from "./aiUsage";

/**
 * How often a call Workers AI turned away for capacity is tried again
 * inside the op, before the op answers AI_CAPACITY and the caller's own
 * retries (a workflow step's, a queue's) take over.
 */
export const WORKERS_AI_CAPACITY_RETRIES = 2;
const CAPACITY_RETRY_BASE_DELAY_MS = 250;

const CAPACITY_MESSAGE =
  /\b(?:rate limit(?:ed| reached)?|too many requests|tokens per (?:day|minute)|tpd|tpm|429|3040)\b|capacity temporarily exceeded/iu;

const numericErrorFact = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
};

/** Workers AI turned the call away because it, or the account, is busy. */
export const isCapacityError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  if (error && typeof error === "object") {
    const facts = error as {
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
    };
    const status = numericErrorFact(facts.status ?? facts.statusCode);
    const code = numericErrorFact(facts.code);
    if (status === 429 || code === 3040 || code === 3036) {
      return true;
    }
    if (code !== undefined) {
      return false;
    }
    if (/\b(?:3040|3036)\b/u.test(message)) {
      return true;
    }
    if (status !== undefined && status >= 400 && status < 500) {
      return false;
    }
  }
  return CAPACITY_MESSAGE.test(message);
};

/** The op failure a call still at capacity after its retries ends with. */
export const aiCapacityFailure = (
  aiFacts: FilesAiGenerationFacts = { validationRetryCount: 0 }
): OpFailure =>
  new OpFailure("ai_capacity", {
    aiFacts,
    message: "workers_ai_capacity_exhausted",
  });

const waitForCapacityRetry = (attempt: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, CAPACITY_RETRY_BASE_DELAY_MS * 2 ** attempt);
  });

export interface WorkersAiEnv extends AiGatewayEnv, AiUsageEnv {
  AI?: WorkersAiBinding;
}

/**
 * Every Workers AI call an op makes: metered, sent through the AI Gateway
 * when one is set, and tried again with backoff while Workers AI is at
 * capacity. A call still at capacity throws the `ai_capacity` op failure
 * (AI_CAPACITY), carrying `aiFacts` when the caller has them; any other
 * error comes back as Workers AI threw it.
 *
 * `capacityRetries: 0` leaves the waiting to the caller: card metadata's
 * workflow step backs off for half a minute and more on AI_CAPACITY, and
 * embeddings answer Convex inside its timeout.
 */
export const runWorkersAi = async (
  env: WorkersAiEnv,
  call: {
    aiFacts?: FilesAiGenerationFacts;
    capacityRetries?: number;
    functionId: string;
    input: Record<string, unknown>;
    model: string;
  }
): Promise<unknown> => {
  const retries = call.capacityRetries ?? WORKERS_AI_CAPACITY_RETRIES;
  const ai = env.AI;
  if (!ai) {
    throw new Error("workers_ai_not_configured");
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await meteredAiRun(
        env,
        {
          functionId: call.functionId,
          isCapacity: isCapacityError,
          model: call.model,
        },
        () => ai.run(call.model, call.input, aiRunOptions(env))
      );
    } catch (error) {
      if (!isCapacityError(error)) {
        throw error;
      }
      if (attempt >= retries) {
        throw aiCapacityFailure(call.aiFacts);
      }
      await waitForCapacityRetry(attempt);
    }
  }
};
