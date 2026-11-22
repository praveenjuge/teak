import type { FilesAiGenerationFacts } from "@teak/files-protocol";
import { errorMessage } from "../errors";
import { OpFailure } from "../opFailure";
import { withRetries } from "../retry";
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
  const message = errorMessage(error);
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

const PROVIDER_FAILURE_CODES = new Set([5007, 5028]);

/**
 * Workers AI itself failed: a 5xx, an internal error (5007) or a retired
 * model (5028, as on 2026-11-20). Another try later may work, or a fixed
 * deploy will, so callers wait the way they do for capacity instead of
 * failing the card.
 */
export const isProviderFailure = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const facts = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  const status = numericErrorFact(facts.status ?? facts.statusCode);
  const code =
    numericErrorFact(facts.code) ??
    numericErrorFact(/^(\d{4}):/u.exec(errorMessage(error))?.[1]);
  return (
    (code !== undefined && PROVIDER_FAILURE_CODES.has(code)) ||
    (status !== undefined && status >= 500 && status < 600)
  );
};

/** The op failure a call still at capacity after its retries ends with. */
export const aiCapacityFailure = (
  aiFacts: FilesAiGenerationFacts = { validationRetryCount: 0 }
): OpFailure =>
  new OpFailure("ai_capacity", {
    aiFacts,
    message: "workers_ai_capacity_exhausted",
  });

export interface WorkersAiEnv extends AiGatewayEnv, AiUsageEnv {
  AI?: WorkersAiBinding;
}

/**
 * Every Workers AI call an op makes: metered, sent through the AI Gateway
 * when one is set, and tried again with backoff while Workers AI is at
 * capacity. A call still at capacity, or one Workers AI failed itself
 * (`isProviderFailure`), throws the `ai_capacity` op failure (AI_CAPACITY),
 * carrying `aiFacts` when the caller has them; any other error comes back as
 * Workers AI threw it.
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
  try {
    return await withRetries(
      () =>
        meteredAiRun(
          env,
          {
            functionId: call.functionId,
            isCapacity: isCapacityError,
            model: call.model,
          },
          () => ai.run(call.model, call.input, aiRunOptions(env))
        ),
      {
        attempts: retries + 1,
        delayMs: (attempt) => CAPACITY_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        isRetryable: isCapacityError,
      }
    );
  } catch (error) {
    // A provider failure answers AI_CAPACITY too, so the caller's step
    // backs off and then defers instead of losing the card.
    throw isCapacityError(error) || isProviderFailure(error)
      ? aiCapacityFailure(call.aiFacts)
      : error;
  }
};
