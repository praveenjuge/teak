"use node";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import * as Sentry from "@sentry/node";
import { env } from "../_generated/server";
import { configureMetrics, type MetricAttributes } from "../shared/metrics";
import {
  buildBackendRelease,
  buildTelemetryContext,
  normalizeErrorClass,
  resolveBackendTelemetryDsn,
  resolveBackendTraceSampleRate,
  resolveTelemetryEnvironment,
  scrubTelemetryString,
  scrubTelemetryValue,
  TELEMETRY_METRICS,
  type TelemetryAttributes,
  type TelemetryContextInput,
  type TelemetryEnvironment,
  type TelemetryMetricName,
  type TelemetryOperation,
  type TelemetryOutcome,
  type TelemetryStage,
} from "../shared/telemetry";

import { sampleBackendTransaction } from "./sampling";

const invocation = new AsyncLocalStorage<{ active: boolean }>();

const FLUSH_TIMEOUT_MS = 2000;
const CONTENT_LIMIT = 16_000;
const CONTENT_SEPARATOR = "\n…[content truncated]…\n";
const BACKEND_TRACER_NAME = "teak-backend";

let initialized = false;
let enabled = false;

const resolveBackendEnvironment = (): TelemetryEnvironment =>
  resolveTelemetryEnvironment({
    explicit: env.SENTRY_ENVIRONMENT,
    nodeEnvironment: process.env.NODE_ENV,
  });

export const resolveBackendRelease = (): string | undefined =>
  env.SENTRY_RELEASE?.trim() ||
  buildBackendRelease(
    env.CONVEX_GIT_COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA
  );

interface PreparedString {
  content: string;
  hash?: string;
  originalLength: number;
  truncated: boolean;
}

const prepareString = (value: string): PreparedString => {
  const content = scrubTelemetryString(value);
  if (content.length <= CONTENT_LIMIT) {
    return { content, originalLength: value.length, truncated: false };
  }
  const available = CONTENT_LIMIT - CONTENT_SEPARATOR.length;
  const prefixLength = Math.ceil(available / 2);
  const suffixLength = Math.floor(available / 2);
  return {
    content: `${content.slice(0, prefixLength)}${CONTENT_SEPARATOR}${content.slice(
      -suffixLength
    )}`,
    hash: createHash("sha256").update(content).digest("hex"),
    originalLength: value.length,
    truncated: true,
  };
};

const sanitizeSpanData = (
  data: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!data) {
    return;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") {
      sanitized[key] = scrubTelemetryValue(value);
      continue;
    }
    const prepared = prepareString(value);
    sanitized[key] = prepared.content;
    if (prepared.truncated) {
      sanitized[`${key}.content.truncated`] = true;
      sanitized[`${key}.content.original_length`] = prepared.originalLength;
      sanitized[`${key}.content.sha256`] = prepared.hash;
    }
  }
  return sanitized;
};

const sanitizeSpan = <T extends { data?: Record<string, unknown> }>(
  span: T
): T =>
  scrubTelemetryValue({
    ...span,
    data: sanitizeSpanData(span.data),
  }) as T;

const safely = (callback: () => void): void => {
  try {
    callback();
  } catch {
    // Observability must never alter application outcomes.
  }
};

const createMetricsRecorder = () => ({
  count: (name: string, value: number, attributes: MetricAttributes) => {
    Sentry.metrics.count(name, value, {
      attributes: metricDimensions(attributes),
    });
  },
  distribution: (
    name: string,
    value: number,
    attributes: MetricAttributes,
    unit?: "millisecond" | "second" | "byte" | "kilobyte" | "megabyte" | "none"
  ) => {
    Sentry.metrics.distribution(name, value, {
      attributes: metricDimensions(attributes),
      unit,
    });
  },
  gauge: (
    name: string,
    value: number,
    attributes: MetricAttributes,
    unit?: "millisecond" | "second" | "byte" | "kilobyte" | "megabyte" | "none"
  ) => {
    Sentry.metrics.gauge(name, value, {
      attributes: metricDimensions(attributes),
      unit,
    });
  },
});

export const ensureBackendTelemetry = (): boolean => {
  if (initialized) {
    return enabled;
  }
  initialized = true;
  const dsn = resolveBackendTelemetryDsn(env);
  if (!dsn) {
    return false;
  }

  const environment = resolveBackendEnvironment();
  try {
    Sentry.init({
      beforeSend: (event) => scrubTelemetryValue(event) as typeof event,
      beforeSendLog: (log) => scrubTelemetryValue(log) as typeof log,
      beforeSendSpan: sanitizeSpan,
      beforeSendTransaction: (event) =>
        sampleBackendTransaction(event, environment),
      dsn,
      enableLogs: true,
      environment,
      integrations: [
        Sentry.consoleLoggingIntegration({
          levels: ["warn", "error"],
        }),
        Sentry.vercelAIIntegration({
          enableTruncation: false,
          force: true,
          recordInputs: false,
          recordOutputs: false,
        }),
      ],
      release: resolveBackendRelease(),
      sendDefaultPii: false,
      // Head sampling cannot know the eventual duration or failure outcome.
      streamGenAiSpans: false,
      tracesSampleRate: 1,
    });
    Sentry.validateOpenTelemetrySetup();
    configureMetrics({
      app: "convex",
      env: environment,
      recorder: createMetricsRecorder(),
    });
    enabled = true;
  } catch {
    enabled = false;
  }
  return enabled;
};

export const flushBackendTelemetry = async (): Promise<boolean> => {
  if (invocation.getStore()?.active || !ensureBackendTelemetry()) {
    return false;
  }
  try {
    return await Sentry.flush(FLUSH_TIMEOUT_MS);
  } catch {
    return false;
  }
};

const contextAttributes = async (
  input: TelemetryContextInput,
  stage?: TelemetryStage
): Promise<Record<string, string | number | boolean>> => {
  const context = await buildTelemetryContext(input);
  const rawAttributes: TelemetryAttributes = {
    ...context.attributes,
    "card.id_hash": context.cardIdHash,
    environment: resolveBackendEnvironment(),
    operation: context.operation,
    release: context.release ?? resolveBackendRelease(),
    stage,
    surface: context.surface,
    "trace.id": context.traceId,
    "user.id_hash": context.userIdHash,
    "workflow.id_hash": context.workflowIdHash,
  };
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(rawAttributes)) {
    if (["string", "number", "boolean"].includes(typeof value)) {
      attributes[key] = value as string | number | boolean;
    }
  }
  return attributes;
};

export interface BackendSpanInput extends TelemetryContextInput {
  name: string;
  stage?: TelemetryStage;
}

export const isRetryableBackendError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /retry|waiting|not yet|no (?:object|output) generated|failed to validate json|response did not match schema|rate.?limit|too many requests|tokens per (?:day|minute)|\b(?:tpd|tpm|429)\b/iu.test(
    message
  );
};

const metricDimensions = (attributes: MetricAttributes): MetricAttributes =>
  Object.fromEntries(
    Object.entries(attributes).filter(([key]) => key !== "duration.ms")
  );

const recordSpan = async <T>(
  input: BackendSpanInput,
  callback: () => Promise<T>
): Promise<T> => {
  if (!ensureBackendTelemetry()) {
    return await callback();
  }
  const attributes = await contextAttributes(input, input.stage);
  // Durations are measurements and span data, never metric dimensions.
  const metricAttributes = metricDimensions(attributes);
  const tracer = trace.getTracer(BACKEND_TRACER_NAME, resolveBackendRelease());
  let callbackStarted = false;
  try {
    return await tracer.startActiveSpan(
      input.name,
      {
        attributes: {
          ...attributes,
          "sentry.op": input.operation,
        },
      },
      async (span) => {
        callbackStarted = true;
        const isWorkflowOperation = input.operation.startsWith("teak.workflow");
        const startedAt = Date.now();
        try {
          const result = await callback();
          const durationMs = Date.now() - startedAt;
          const resultRecord =
            result && typeof result === "object"
              ? (result as Record<string, unknown>)
              : undefined;
          const returnedFailure =
            resultRecord?.success === false ||
            resultRecord?.ok === false ||
            resultRecord?.status === "failed";
          const outcome =
            returnedFailure || attributes.outcome === "failure"
              ? "failure"
              : "success";
          span.setAttribute("outcome", outcome);
          span.setAttribute(
            "duration.ms",
            Math.max(durationMs, Number(attributes["duration.ms"]) || 0)
          );
          if (resultRecord?.mode === "skipped") {
            span.setAttribute("outcome", "skipped");
          }
          span.setStatus({
            code: returnedFailure ? SpanStatusCode.ERROR : SpanStatusCode.OK,
          });
          if (isWorkflowOperation) {
            safely(() =>
              Sentry.metrics.distribution(
                TELEMETRY_METRICS.workflowStageDuration,
                durationMs,
                {
                  attributes: { ...metricAttributes, outcome },
                  unit: "millisecond",
                }
              )
            );
          }
          if (
            isWorkflowOperation &&
            result &&
            typeof result === "object" &&
            "mode" in result &&
            result.mode === "skipped"
          ) {
            safely(() =>
              Sentry.metrics.count(TELEMETRY_METRICS.workflowSkip, 1, {
                attributes: { ...metricAttributes, outcome: "skipped" },
              })
            );
          }
          if (returnedFailure && isWorkflowOperation) {
            safely(() =>
              Sentry.metrics.count(TELEMETRY_METRICS.workflowFailure, 1, {
                attributes: { ...metricAttributes, outcome },
              })
            );
          }
          if (
            resolveBackendTraceSampleRate({
              durationMs: Math.max(
                durationMs,
                Number(attributes["duration.ms"]) || 0
              ),
              environment: resolveBackendEnvironment(),
              name: input.name,
              operation: input.operation,
              outcome,
            }) > Math.random()
          ) {
            safely(() =>
              Sentry.logger[returnedFailure ? "error" : "info"](
                "telemetry.operation.completed",
                {
                  ...attributes,
                  "duration.ms": durationMs,
                  outcome,
                }
              )
            );
          }
          return result;
        } catch (error) {
          const durationMs = Date.now() - startedAt;
          const errorClass = normalizeErrorClass(error);
          const retryable = isRetryableBackendError(error);
          span.setAttribute("duration.ms", durationMs);
          span.setAttribute("error.class", errorClass);
          span.setAttribute("outcome", "failure");
          span.setAttribute("retryable", retryable);
          span.recordException(error instanceof Error ? error : String(error));
          span.setStatus({ code: SpanStatusCode.ERROR, message: errorClass });
          if (!retryable) {
            safely(() =>
              Sentry.captureException(error, {
                tags: {
                  "error.class": errorClass,
                  operation: input.operation,
                  stage: input.stage,
                  surface: input.surface,
                },
              })
            );
          }
          safely(() =>
            Sentry.logger[retryable ? "info" : "error"](
              retryable
                ? "telemetry.operation.retrying"
                : "telemetry.operation.failed",
              {
                ...attributes,
                "duration.ms": durationMs,
                "error.class": errorClass,
                outcome: retryable ? "retry" : "failure",
              }
            )
          );
          if (isWorkflowOperation) {
            safely(() =>
              Sentry.metrics.distribution(
                TELEMETRY_METRICS.workflowStageDuration,
                durationMs,
                {
                  attributes: {
                    ...metricAttributes,
                    "error.class": errorClass,
                    outcome: "failure",
                  },
                  unit: "millisecond",
                }
              )
            );
            safely(() =>
              Sentry.metrics.count(TELEMETRY_METRICS.workflowFailure, 1, {
                attributes: {
                  ...metricAttributes,
                  "error.class": errorClass,
                  outcome: "failure",
                },
              })
            );
          }
          if (retryable && isWorkflowOperation) {
            safely(() =>
              Sentry.metrics.count(TELEMETRY_METRICS.workflowRetry, 1, {
                attributes: {
                  ...metricAttributes,
                  "error.class": errorClass,
                  outcome: "retry",
                },
              })
            );
          }
          throw error;
        } finally {
          span.end();
        }
      }
    );
  } catch (error) {
    if (callbackStarted) {
      throw error;
    }
    return await callback();
  }
};

/** Nested and concurrent child spans share one flush at the owning action boundary. */
export const withBackendSpan = async <T>(
  input: BackendSpanInput,
  callback: () => Promise<T>
): Promise<T> => {
  if (invocation.getStore()?.active) {
    return await recordSpan(input, callback);
  }
  const state = { active: true };
  return await invocation.run(state, async () => {
    try {
      return await recordSpan(input, callback);
    } finally {
      state.active = false;
      await flushBackendTelemetry();
    }
  });
};

export const recordBackendMetric = (
  name: TelemetryMetricName,
  value: number,
  attributes: TelemetryAttributes = {},
  unit?: "millisecond" | "second" | "byte" | "none"
): void => {
  if (!ensureBackendTelemetry()) {
    return;
  }
  safely(() => {
    if (unit) {
      Sentry.metrics.distribution(name, value, {
        attributes: metricDimensions(attributes),
        unit,
      });
      return;
    }
    Sentry.metrics.count(name, value, {
      attributes: metricDimensions(attributes),
    });
  });
};

/** Record shape only: private AI inputs and outputs never leave in telemetry. */
export const recordBackendAiContent = (input: {
  prompt?: string;
  response?: string;
  system?: string;
}): void => {
  safely(() => {
    const span = trace.getActiveSpan();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        span?.setAttribute(`gen_ai.${key}.characters`, value.length);
      }
    }
  });
};

export const recordBackendHandledFailure = (
  error: unknown,
  input: {
    attributes?: TelemetryAttributes;
    operation: string;
    stage?: TelemetryStage;
  }
): void => {
  if (!ensureBackendTelemetry()) {
    return;
  }
  const errorClass = normalizeErrorClass(error);
  const attributes = {
    ...input.attributes,
    "error.class": errorClass,
    operation: input.operation,
    outcome: "failure",
    stage: input.stage,
    surface: "backend",
  };
  safely(() =>
    Sentry.captureException(error, {
      tags: {
        "error.class": errorClass,
        operation: input.operation,
        stage: input.stage,
        surface: "backend",
      },
    })
  );
  safely(() =>
    Sentry.logger.error("telemetry.operation.handled_failure", attributes)
  );
  if (input.operation.startsWith("teak.workflow")) {
    safely(() =>
      Sentry.metrics.count(TELEMETRY_METRICS.workflowFailure, 1, {
        attributes: metricDimensions(attributes),
      })
    );
  }
};

export const recordBackendLog = (
  level: "info" | "warn" | "error",
  message: string,
  attributes: TelemetryAttributes = {}
): void => {
  if (!ensureBackendTelemetry()) {
    return;
  }
  safely(() => Sentry.logger[level](message, attributes));
};

export const recordBackendOutcome = async (input: {
  attributes?: TelemetryAttributes;
  cardId?: string;
  metric: TelemetryMetricName;
  operation: TelemetryOperation;
  outcome: TelemetryOutcome;
  stage?: TelemetryStage;
  surface?: string;
  userId?: string;
  workflowId?: string;
}): Promise<boolean> => {
  if (!ensureBackendTelemetry()) {
    return false;
  }
  const operation = input.operation;
  const attributes = await contextAttributes(
    {
      attributes: {
        ...input.attributes,
        origin: input.surface ?? "unknown",
        outcome: input.outcome,
      },
      cardId: input.cardId,
      operation,
      release: resolveBackendRelease(),
      surface: "backend",
      userId: input.userId,
      workflowId: input.workflowId,
    },
    input.stage
  );
  await withBackendSpan(
    {
      attributes: {
        ...input.attributes,
        origin: input.surface ?? "unknown",
        outcome: input.outcome,
      },
      cardId: input.cardId,
      name: input.metric,
      operation,
      stage: input.stage,
      surface: "backend",
      userId: input.userId,
      workflowId: input.workflowId,
    },
    () => {
      safely(() =>
        Sentry.metrics.count(input.metric, 1, {
          attributes: metricDimensions(attributes),
        })
      );
      if (
        resolveBackendTraceSampleRate({
          environment: resolveBackendEnvironment(),
          operation: input.operation,
          outcome: input.outcome,
        }) > Math.random()
      ) {
        safely(() =>
          Sentry.logger[input.outcome === "failure" ? "error" : "info"](
            input.metric,
            attributes
          )
        );
      }
      return Promise.resolve({ success: input.outcome !== "failure" });
    }
  );
  return true;
};

export const BACKEND_CARD_METRICS = {
  failure: TELEMETRY_METRICS.cardFailure,
  success: TELEMETRY_METRICS.cardSuccess,
} as const;

export interface CronCheckInConfig {
  checkinMarginMinutes: number;
  /**
   * Consecutive failed check-ins before Sentry opens an issue. Defaults to 1.
   * Only sub-hourly monitors should raise it, so one lost completion
   * check-in does not page while a real outage still alerts quickly.
   */
  failureIssueThreshold?: number;
  maxRuntimeMinutes: number;
  schedule: string;
  slug: string;
}

export const withCronCheckIn = async <T>(
  config: CronCheckInConfig,
  callback: () => Promise<T>
): Promise<T> => {
  if (!ensureBackendTelemetry()) {
    return await callback();
  }

  const startedAt = Date.now();
  let checkInId: string | undefined;
  safely(() => {
    checkInId = Sentry.captureCheckIn(
      { monitorSlug: config.slug, status: "in_progress" },
      {
        checkinMargin: config.checkinMarginMinutes,
        failureIssueThreshold: config.failureIssueThreshold ?? 1,
        maxRuntime: config.maxRuntimeMinutes,
        recoveryThreshold: 1,
        schedule: { type: "crontab", value: config.schedule },
        timezone: "UTC",
      }
    );
  });

  return await withBackendSpan(
    {
      attributes: { monitor: config.slug },
      name: `cron.${config.slug}`,
      operation: "teak.workflow",
      stage: "cron",
      surface: "backend",
    },
    async () => {
      try {
        const result = await callback();
        const durationMs = Date.now() - startedAt;
        recordBackendMetric(TELEMETRY_METRICS.cronSuccess, 1, {
          monitor: config.slug,
          outcome: "success",
        });
        recordBackendMetric(
          TELEMETRY_METRICS.cronDuration,
          durationMs,
          { monitor: config.slug, outcome: "success" },
          "millisecond"
        );
        safely(() =>
          Sentry.captureCheckIn({
            ...(checkInId ? { checkInId } : {}),
            duration: durationMs / 1000,
            monitorSlug: config.slug,
            status: "ok",
          })
        );
        return result;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        recordBackendMetric(TELEMETRY_METRICS.cronFailure, 1, {
          "error.class": normalizeErrorClass(error),
          monitor: config.slug,
          outcome: "failure",
        });
        recordBackendMetric(
          TELEMETRY_METRICS.cronDuration,
          durationMs,
          { monitor: config.slug, outcome: "failure" },
          "millisecond"
        );
        safely(() =>
          Sentry.captureCheckIn({
            ...(checkInId ? { checkInId } : {}),
            duration: durationMs / 1000,
            monitorSlug: config.slug,
            status: "error",
          })
        );
        throw error;
      }
    }
  );
};
