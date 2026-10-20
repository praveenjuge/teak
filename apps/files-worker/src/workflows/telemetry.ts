import type { ServerEventCatalog } from "@teak/convex/shared/analytics";
import {
  createPostHogBatch,
  type PostHogBatch,
} from "@teak/convex/shared/posthog";
import packageJson from "../../package.json";
import { estimateWorkersAiCostUsd } from "../ai/aiPricing";
import { reportBackgroundError, type TelemetryEnvVars } from "../telemetry";

// PostHog events from workflow steps and queue consumers. One isolate runs
// many steps at once, so nothing here lives at module level: each step makes
// its own batch and flushes it before it returns.

export const WORKERS_AI_PROVIDER = "cloudflare";

export interface WorkflowTelemetry {
  flush: () => Promise<void>;
  record: <Name extends "$ai_generation" | "card_processing_completed">(
    event: Name,
    properties: ServerEventCatalog[Name]
  ) => void;
}

export const createWorkflowTelemetry = (
  env: TelemetryEnvVars,
  options: { fetch?: typeof fetch } = {}
): WorkflowTelemetry => {
  const batch: PostHogBatch = createPostHogBatch({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    lib: "teak-files-worker",
    libVersion: packageJson.version,
    platform: "node:javascript",
    token: env.POSTHOG_PROJECT_TOKEN,
  });
  return {
    flush: async () => {
      await batch.flush();
    },
    record: (event, properties) => {
      batch.capture({
        event,
        properties: {
          ...properties,
          $app_version: packageJson.version,
          surface: "files-worker",
        },
      });
    },
  };
};

export const withWorkflowTelemetry = async <T>(
  env: TelemetryEnvVars,
  callback: (telemetry: WorkflowTelemetry) => Promise<T>
): Promise<T> => {
  const telemetry = createWorkflowTelemetry(env);
  try {
    return await callback(telemetry);
  } finally {
    await telemetry.flush();
  }
};

interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
}

const usageOf = (value: unknown): AiUsage | undefined =>
  value && typeof value === "object" && "usage" in value
    ? ((value as { usage?: AiUsage }).usage ?? undefined)
    : undefined;

export const observeAiGeneration = async <T>(
  telemetry: WorkflowTelemetry,
  input: { functionId: string; model: string; traceId?: string },
  generate: () => Promise<T>
): Promise<T> => {
  const startedAt = Date.now();
  const record = (usage: AiUsage | undefined, error?: unknown) =>
    telemetry.record("$ai_generation", {
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
      ...(input.traceId ? { $ai_trace_id: input.traceId } : {}),
    });
  try {
    const result = await generate();
    record(usageOf(result));
    return result;
  } catch (error) {
    record(
      error && typeof error === "object" && "aiFacts" in error
        ? usageOf((error as { aiFacts?: unknown }).aiFacts)
        : undefined,
      error
    );
    throw error;
  }
};

export const emitCardProcessingCompleted = (
  env: TelemetryEnvVars,
  properties: { cardType: string; durationMs: number }
): Promise<void> =>
  withWorkflowTelemetry(env, (telemetry) => {
    telemetry.record("card_processing_completed", {
      card_type: properties.cardType,
      duration_ms: properties.durationMs,
    });
    return Promise.resolve();
  });

export const isRetryableBackgroundError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /retry|waiting|not yet|no (?:object|output) generated|failed to validate json|response did not match schema|rate.?limit|too many requests|tokens per (?:day|minute)|\b(?:tpd|tpm|429)\b|stale_processing_revision|card_missing/iu.test(
    message
  );
};

const isNonRetryable = (error: unknown): boolean =>
  error instanceof Error && error.name === "NonRetryableError";

export const reportedStep =
  <T>(
    env: TelemetryEnvVars,
    context: {
      cardId?: string;
      maxAttempts: number;
      name: string;
      stage: string;
    },
    body: (ctx: { attempt: number }) => Promise<T>
  ) =>
  async (ctx: { attempt: number }): Promise<T> => {
    try {
      return await body(ctx);
    } catch (error) {
      const final = isNonRetryable(error) || ctx.attempt >= context.maxAttempts;
      if (final && !isRetryableBackgroundError(error)) {
        await reportBackgroundError(env, undefined, error, {
          task: "card-processing",
          name: context.name,
          stage: context.stage,
          ...(context.cardId ? { "card.id": context.cardId } : {}),
        }).catch(() => undefined);
      }
      throw error;
    }
  };
