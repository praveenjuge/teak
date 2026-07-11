import {
  normalizeErrorClass,
  normalizeTelemetryAttributes,
  TELEMETRY_METRICS,
} from "./telemetry";

/**
 * Shared metrics helpers for Teak.
 *
 * This module exposes a small, SDK-agnostic surface that any app (web, mobile,
 * desktop, extension, API, Convex actions) can call. Host apps wire in a
 * concrete recorder via `configureMetrics` at startup. Sentry's Application
 * Metrics API is the intended primary backend, but anything implementing the
 * `MetricsRecorder` interface works (datadog, statsd, otel, custom log
 * shipper, etc.).
 *
 * Design goals:
 * - Zero runtime coupling to `@sentry/*` so this file can be imported from
 *   Convex actions and pure utility code.
 * - Safe default behaviour: a no-op recorder. Metrics never become duplicate
 *   console-log events and telemetry failures never affect product behavior.
 * - Consistent tag shape (`surface`, `environment`, plus bounded attributes).
 *
 * Usage:
 *
 * ```ts
 * import { configureMetrics, trackCardCreateAttempt } from "@teak/convex/shared/metrics";
 *
 * configureMetrics({
 *   app: "web",
 *   env: process.env.NODE_ENV,
 *   recorder: {
 *     count: (name, value, attributes) =>
 *       Sentry.metrics.count(name, value, { attributes }),
 *     gauge: (name, value, attributes, unit) =>
 *       Sentry.metrics.gauge(name, value, { attributes, unit }),
 *     distribution: (name, value, attributes, unit) =>
 *       Sentry.metrics.distribution(name, value, { attributes, unit }),
 *   },
 * });
 *
 * trackCardCreateAttempt({ cardType: "link", source: "web" });
 * ```
 */

export type MetricAttributeValue = string | number | boolean | undefined | null;

export type MetricAttributes = Record<string, MetricAttributeValue>;

export type MetricUnit =
  | "millisecond"
  | "second"
  | "byte"
  | "kilobyte"
  | "megabyte"
  | "none";

export type TeakApp =
  | "web"
  | "mobile"
  | "desktop"
  | "extension"
  | "raycast"
  | "api"
  | "convex"
  | "docs";

export interface MetricsRecorder {
  count: (name: string, value: number, attributes: MetricAttributes) => void;
  distribution: (
    name: string,
    value: number,
    attributes: MetricAttributes,
    unit?: MetricUnit
  ) => void;
  gauge: (
    name: string,
    value: number,
    attributes: MetricAttributes,
    unit?: MetricUnit
  ) => void;
}

export interface MetricsConfig {
  app?: TeakApp;
  env?: string;
  recorder?: MetricsRecorder;
}

// ---------------------------------------------------------------------------
// Default recorder. Hosts configure a first-class Sentry recorder at startup.
// ---------------------------------------------------------------------------

const noopRecorder: MetricsRecorder = {
  count() {
    // Telemetry is intentionally disabled until the host configures a recorder.
  },
  distribution() {
    // Telemetry is intentionally disabled until the host configures a recorder.
  },
  gauge() {
    // Telemetry is intentionally disabled until the host configures a recorder.
  },
};

// ---------------------------------------------------------------------------
// Module-level config
// ---------------------------------------------------------------------------

interface InternalConfig {
  app: TeakApp;
  env: string;
  recorder: MetricsRecorder;
}

const defaultConfig: InternalConfig = {
  app: "convex",
  env: "development",
  recorder: noopRecorder,
};

let activeConfig: InternalConfig = defaultConfig;

export function configureMetrics(config: MetricsConfig): void {
  activeConfig = {
    app: config.app ?? activeConfig.app,
    env: config.env ?? activeConfig.env,
    recorder: config.recorder ?? activeConfig.recorder,
  };
}

/**
 * Reset configuration to the defaults. Intended for tests and hot reload.
 */
export function resetMetricsConfig(): void {
  activeConfig = defaultConfig;
}

function withBaseAttributes(attributes?: MetricAttributes): MetricAttributes {
  return normalizeTelemetryAttributes({
    surface: activeConfig.app === "convex" ? "backend" : activeConfig.app,
    environment: activeConfig.env,
    ...(attributes ?? {}),
  });
}

export function safeRecord(fn: () => void): void {
  try {
    fn();
  } catch {
    // Metrics must never alter application outcomes.
  }
}

// ---------------------------------------------------------------------------
// Low-level primitives
// ---------------------------------------------------------------------------

export function counter(
  name: string,
  value = 1,
  attributes?: MetricAttributes
): void {
  safeRecord(() => {
    activeConfig.recorder.count(name, value, withBaseAttributes(attributes));
  });
}

export function gauge(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  unit?: MetricUnit
): void {
  safeRecord(() => {
    activeConfig.recorder.gauge(
      name,
      value,
      withBaseAttributes(attributes),
      unit
    );
  });
}

export function distribution(
  name: string,
  value: number,
  attributes?: MetricAttributes,
  unit?: MetricUnit
): void {
  safeRecord(() => {
    activeConfig.recorder.distribution(
      name,
      value,
      withBaseAttributes(attributes),
      unit
    );
  });
}

/**
 * Measure the duration of an async function and emit a distribution metric.
 * Always resolves (or re-throws) with the original value; timing is emitted in
 * both success and failure paths, tagged `outcome=ok|error`.
 */
export async function timedAsync<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: MetricAttributes
): Promise<T> {
  const start = nowMs();
  try {
    const result = await fn();
    distribution(
      name,
      nowMs() - start,
      { ...(attributes ?? {}), outcome: "ok" },
      "millisecond"
    );
    return result;
  } catch (error) {
    distribution(
      name,
      nowMs() - start,
      {
        ...(attributes ?? {}),
        outcome: "error",
        "error.class": normalizeErrorClass(error),
      },
      "millisecond"
    );
    throw error;
  }
}

function nowMs(): number {
  if (typeof performance !== "undefined" && performance?.now) {
    return performance.now();
  }
  return Date.now();
}

// ---------------------------------------------------------------------------
// Domain helpers – keep cardinality low and names stable.
// ---------------------------------------------------------------------------

export type CardCreationSource =
  | "web"
  | "mobile"
  | "desktop"
  | "extension"
  | "raycast"
  | "api"
  | "mcp"
  | "share_intent"
  | "drag_drop"
  | "import"
  | "paste"
  | "unknown";

export function trackCardCreateAttempt(params: {
  cardType?: string;
  source: CardCreationSource;
  via?: string;
}): void {
  const configuredSource = ["web", "mobile", "desktop"].includes(
    activeConfig.app
  )
    ? activeConfig.app
    : params.source;
  counter(TELEMETRY_METRICS.cardAttempt, 1, {
    "card.type": params.cardType ?? "unknown",
    source: configuredSource,
    via: params.via ?? null,
  });
}

export type AiPipelineStage =
  | "classification"
  | "categorization"
  | "metadata"
  | "renderables"
  | "linkMetadata"
  | "palette";

export type AiStageOutcome = "ok" | "error" | "skipped";

export function trackAiStage(params: {
  stage: AiPipelineStage;
  durationMs: number;
  outcome: AiStageOutcome;
  cardType?: string;
  errorClass?: string;
}): void {
  distribution(
    TELEMETRY_METRICS.workflowStageDuration,
    params.durationMs,
    {
      stage: params.stage,
      outcome: params.outcome,
      "card.type": params.cardType ?? null,
      "error.class": params.errorClass ?? null,
    },
    "millisecond"
  );

  if (params.outcome === "error") {
    counter(TELEMETRY_METRICS.workflowFailure, 1, {
      stage: params.stage,
      "card.type": params.cardType ?? null,
      "error.class": params.errorClass ?? null,
    });
  }
}

export function trackUpload(params: {
  bytes?: number;
  durationMs?: number;
  fileBucket: string;
  outcome: "attempt" | "success" | "failure";
  source: CardCreationSource;
}): void {
  const attributes = {
    "file.bucket": params.fileBucket,
    outcome: params.outcome,
    source: params.source,
  };
  if (params.outcome === "attempt") {
    counter(TELEMETRY_METRICS.uploadAttempts, 1, attributes);
  }
  if (params.outcome === "failure") {
    counter(TELEMETRY_METRICS.uploadFailure, 1, attributes);
  }
  if (typeof params.bytes === "number") {
    distribution(
      TELEMETRY_METRICS.uploadBytes,
      params.bytes,
      attributes,
      "byte"
    );
  }
  if (typeof params.durationMs === "number") {
    distribution(
      TELEMETRY_METRICS.uploadDuration,
      params.durationMs,
      attributes,
      "millisecond"
    );
  }
}

export function trackSearch(params: {
  durationMs: number;
  resultCount: number;
  surface?: "web" | "mobile" | "desktop";
}): void {
  const surface = ["web", "mobile", "desktop"].includes(activeConfig.app)
    ? activeConfig.app
    : (params.surface ?? "web");
  const attributes = { surface };
  distribution(
    TELEMETRY_METRICS.searchDuration,
    params.durationMs,
    attributes,
    "millisecond"
  );
  if (params.resultCount === 0) {
    counter(TELEMETRY_METRICS.searchZeroResult, 1, attributes);
  }
}

export function trackAuth(params: {
  durationMs?: number;
  outcome: "attempt" | "success" | "failure";
  stage: "bootstrap" | "sign_in" | "session_refresh";
}): void {
  const metric = {
    bootstrap: TELEMETRY_METRICS.authBootstrap,
    session_refresh: TELEMETRY_METRICS.authSessionRefresh,
    sign_in: TELEMETRY_METRICS.authSignIn,
  }[params.stage];
  const attributes = { outcome: params.outcome };
  counter(metric, 1, attributes);
  if (typeof params.durationMs === "number") {
    distribution(metric, params.durationMs, attributes, "millisecond");
  }
}

export function trackCheckout(params: {
  outcome: "start" | "open" | "success" | "cancel" | "failure";
}): void {
  const metric = {
    cancel: TELEMETRY_METRICS.checkoutCancel,
    failure: TELEMETRY_METRICS.checkoutFailure,
    open: TELEMETRY_METRICS.checkoutOpen,
    start: TELEMETRY_METRICS.checkoutStart,
    success: TELEMETRY_METRICS.checkoutSuccess,
  }[params.outcome];
  counter(metric, 1, { outcome: params.outcome });
}

export function trackLifecycle(params: {
  durationMs?: number;
  kind: "import" | "export";
  outcome: "attempt" | "success" | "failure" | "cancelled";
}): void {
  const metric =
    params.kind === "import"
      ? TELEMETRY_METRICS.importLifecycle
      : TELEMETRY_METRICS.exportLifecycle;
  const attributes = { outcome: params.outcome };
  counter(metric, 1, attributes);
  if (typeof params.durationMs === "number") {
    distribution(metric, params.durationMs, attributes, "millisecond");
  }
}

export function trackAiCall(params: {
  costUsd?: number;
  durationMs: number;
  inputTokens?: number;
  model: string;
  outcome: "success" | "failure";
  outputTokens?: number;
  provider: string;
  retries?: number;
  validationFailure?: boolean;
}): void {
  const attributes = {
    model: params.model,
    outcome: params.outcome,
    provider: params.provider,
  };
  counter(TELEMETRY_METRICS.aiCalls, 1, attributes);
  distribution(
    TELEMETRY_METRICS.aiLatency,
    params.durationMs,
    attributes,
    "millisecond"
  );
  if (typeof params.inputTokens === "number") {
    counter(TELEMETRY_METRICS.aiTokensInput, params.inputTokens, attributes);
  }
  if (typeof params.outputTokens === "number") {
    counter(TELEMETRY_METRICS.aiTokensOutput, params.outputTokens, attributes);
  }
  if (params.retries) {
    counter(TELEMETRY_METRICS.aiRetries, params.retries, attributes);
  }
  if (params.validationFailure) {
    counter(TELEMETRY_METRICS.aiValidationFailures, 1, attributes);
  }
  if (typeof params.costUsd === "number") {
    distribution(
      TELEMETRY_METRICS.aiCostUsd,
      params.costUsd,
      attributes,
      "none"
    );
  }
}

export function trackCron(params: {
  durationMs: number;
  monitor: string;
  outcome: "success" | "failure" | "missed";
}): void {
  const metric = {
    failure: TELEMETRY_METRICS.cronFailure,
    missed: TELEMETRY_METRICS.cronMissed,
    success: TELEMETRY_METRICS.cronSuccess,
  }[params.outcome];
  const attributes = { monitor: params.monitor, outcome: params.outcome };
  counter(metric, 1, attributes);
  distribution(
    TELEMETRY_METRICS.cronDuration,
    params.durationMs,
    attributes,
    "millisecond"
  );
}

export function trackMcpToolInvocation(params: {
  tool: string;
  outcome: "ok" | "error" | "unauthorized";
  durationMs: number;
  status?: number;
}): void {
  counter("api.mcp.tool.invocations", 1, {
    tool: params.tool,
    outcome: params.outcome,
    status: params.status ?? null,
  });
  distribution(
    "api.mcp.tool.latency",
    params.durationMs,
    {
      tool: params.tool,
      outcome: params.outcome,
    },
    "millisecond"
  );
}
